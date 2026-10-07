import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExceptionInfo, JobProgress } from '../types';
import { onHostMessage, request } from '../vscode';

export interface JobState<T> {
  running: boolean;
  progress: JobProgress | null;
  result: T | null;
  error: (Partial<ExceptionInfo> & { error: string }) | null;
  startedAt: number | null;
}

/** Runs a long engine job (health check, fuzzing) and tracks its progress events. */
export function useJob<T>(onDone?: (result: T) => void) {
  const [state, setState] = useState<JobState<T>>({ running: false, progress: null, result: null, error: null, startedAt: null });
  const jobId = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(
    () =>
      onHostMessage((msg) => {
        if (msg?.type === 'engineState' && msg.state?.status !== 'ready' && jobId.current !== null) {
          jobId.current = null;
          setState((s) => ({ ...s, running: false, error: { error: 'The Python engine stopped while the job was running.' } }));
          return;
        }
        if (msg?.type !== 'engineEvent' || msg.data?.jobId !== jobId.current || jobId.current === null) return;
        const d = msg.data;
        if (msg.event === 'job_progress') {
          setState((s) => ({ ...s, progress: d }));
        } else if (msg.event === 'job_done') {
          jobId.current = null;
          setState((s) => ({ ...s, running: false, result: d.result }));
          doneRef.current?.(d.result);
        } else if (msg.event === 'job_failed') {
          jobId.current = null;
          setState((s) => ({ ...s, running: false, error: d }));
        }
      }),
    [],
  );

  const start = useCallback(async (cmd: string, args: Record<string, unknown>) => {
    if (jobId.current !== null) void request('cancel_job', { jobId: jobId.current }).catch(() => undefined);
    setState({ running: true, progress: { stage: 'Starting', fraction: 0 }, result: null, error: null, startedAt: Date.now() });
    try {
      const res = await request<{ jobId: number }>(cmd, args);
      jobId.current = res.jobId;
    } catch (err) {
      jobId.current = null;
      setState((s) => ({ ...s, running: false, error: { error: (err as Error).message } }));
    }
  }, []);

  const cancel = useCallback(() => {
    if (jobId.current !== null) void request('cancel_job', { jobId: jobId.current }).catch(() => undefined);
  }, []);

  return { ...state, start, cancel };
}
