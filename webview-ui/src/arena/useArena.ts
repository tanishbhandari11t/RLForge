import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentDesc,
  Anomaly,
  EngineError,
  EpisodeSummary,
  Inspection,
  SessionStatus,
  TimelineEntry,
} from '../types';
import { onHostMessage, request, RequestError } from '../vscode';

const MAX_ENTRIES = 5000;
const FRAME_KEEP = 1500;
const MAX_HISTORY = 500;

export interface AgentConfig {
  kind: 'random' | 'sb3';
  path?: string;
  algorithm?: string;
  deterministic?: boolean;
}

export interface LaunchOptions {
  env: string;
  seed: number | null;
  agent: AgentConfig;
  autoReset: boolean;
}

export interface AnomalyStat {
  code: string;
  level: Anomaly['level'];
  message: string;
  count: number;
  episode: number;
  step: number;
}

export interface ArenaStore {
  sessionId: number;
  envId: string | null;
  inspection: Inspection | null;
  agent: AgentDesc | null;
  status: SessionStatus | null;
  episode: number;
  seed: number | null;
  timeline: TimelineEntry[];
  /** Index into timeline being inspected, or null to follow the live step. */
  cursor: number | null;
  history: EpisodeSummary[];
  anomalies: Record<string, AnomalyStat>;
  episodeAnomalies: number;
  error: EngineError | null;
  warnings: string[];
  loading: boolean;
  loadError: { message: string; traceback?: string } | null;
}

function emptyStore(): ArenaStore {
  return {
    sessionId: 0,
    envId: null,
    inspection: null,
    agent: null,
    status: null,
    episode: 0,
    seed: null,
    timeline: [],
    cursor: null,
    history: [],
    anomalies: {},
    episodeAnomalies: 0,
    error: null,
    warnings: [],
    loading: false,
    loadError: null,
  };
}

export type ArenaController = ReturnType<typeof useArena>;

export function useArena() {
  const store = useRef<ArenaStore>(emptyStore());
  const [, setTick] = useState(0);
  const scheduled = useRef(false);

  const rerender = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    requestAnimationFrame(() => {
      scheduled.current = false;
      setTick((t) => t + 1);
    });
  }, []);

  const startSession = useCallback((id: number) => {
    const s = store.current;
    s.sessionId = id;
    s.status = null;
    s.timeline = [];
    s.cursor = null;
    s.history = [];
    s.anomalies = {};
    s.episodeAnomalies = 0;
    s.error = null;
    s.warnings = [];
  }, []);

  const recordAnomalies = useCallback((list: Anomaly[] | undefined, step: number) => {
    const s = store.current;
    if (!list?.length) return;
    s.episodeAnomalies += list.length;
    for (const a of list) {
      const existing = s.anomalies[a.code];
      if (existing) {
        existing.count++;
      } else {
        s.anomalies[a.code] = { code: a.code, level: a.level, message: a.message, count: 1, episode: s.episode, step };
      }
    }
  }, []);

  const handleEvent = useCallback(
    (event: string, d: any) => {
      const s = store.current;
      if (typeof d?.sessionId === 'number') {
        if (d.sessionId < s.sessionId) return;
        if (d.sessionId > s.sessionId) startSession(d.sessionId);
      }
      switch (event) {
        case 'reset':
          s.episode = d.episode;
          s.seed = d.seed;
          s.episodeAnomalies = 0;
          s.timeline = [
            {
              step: 0,
              obs: d.obs,
              frame: d.frame,
              totalReward: 0,
              terminated: false,
              truncated: false,
              info: d.info,
              anomalies: d.anomalies ?? [],
            },
          ];
          s.cursor = null;
          recordAnomalies(d.anomalies, 0);
          if (s.status) s.status = { ...s.status, episode: d.episode, step: 0, done: false };
          break;
        case 'step': {
          s.timeline.push({
            step: d.step,
            obs: d.obs,
            frame: d.frame,
            action: d.action,
            actionInfo: d.actionInfo,
            reward: d.reward,
            totalReward: d.totalReward,
            terminated: d.terminated,
            truncated: d.truncated,
            info: d.info,
            anomalies: d.anomalies ?? [],
          });
          const stale = s.timeline[s.timeline.length - 1 - FRAME_KEEP];
          if (stale?.frame) stale.frame = undefined;
          if (s.timeline.length > MAX_ENTRIES) {
            s.timeline.shift();
            if (s.cursor !== null) s.cursor = Math.max(0, s.cursor - 1);
          }
          recordAnomalies(d.anomalies, d.step);
          if (s.status) s.status = { ...s.status, step: d.step, done: d.terminated || d.truncated };
          break;
        }
        case 'episode_end':
          s.history.unshift({
            episode: d.episode,
            seed: d.seed,
            return: d.return,
            length: d.length,
            terminated: d.terminated,
            truncated: d.truncated,
            anomalies: s.episodeAnomalies,
          });
          if (s.history.length > MAX_HISTORY) s.history.pop();
          break;
        case 'status':
          s.status = d;
          break;
        case 'frame': {
          const last = s.timeline[s.timeline.length - 1];
          if (last && last.step === d.step) last.frame = d.frame;
          break;
        }
        case 'error':
          s.error = d;
          break;
        case 'warning':
          s.warnings = [...s.warnings.slice(-4), d.message];
          break;
        default:
          return;
      }
      rerender();
    },
    [rerender, startSession, recordAnomalies],
  );

  useEffect(
    () =>
      onHostMessage((msg) => {
        if (msg?.type === 'engineEvent') handleEvent(msg.event, msg.data);
        if (msg?.type === 'engineState' && msg.state?.status !== 'ready') {
          const s = store.current;
          if (s.status?.playing) s.status = { ...s.status, playing: false };
          rerender();
        }
      }),
    [handleEvent, rerender],
  );

  const call = useCallback(
    async (cmd: string, args: Record<string, unknown> = {}) => {
      try {
        return await request(cmd, args);
      } catch (err) {
        const s = store.current;
        s.warnings = [...s.warnings.slice(-4), (err as Error).message];
        rerender();
        return undefined;
      }
    },
    [rerender],
  );

  const setPlaying = (playing: boolean) => {
    const s = store.current;
    if (s.status) s.status = { ...s.status, playing };
  };

  const actions = {
    launch: async (opts: LaunchOptions) => {
      const s = store.current;
      s.loading = true;
      s.loadError = null;
      s.error = null;
      rerender();
      try {
        const res = await request<{
          sessionId: number;
          inspection: Inspection;
          agent: AgentDesc;
          status: SessionStatus;
        }>('load', {
          env: opts.env,
          seed: opts.seed,
          agent: opts.agent,
          autoReset: opts.autoReset,
          speed: s.status?.speed ?? 1,
        });
        if (res.sessionId > s.sessionId) startSession(res.sessionId);
        s.envId = opts.env;
        s.inspection = res.inspection;
        s.agent = res.agent;
        s.status = s.status ?? res.status;
        return true;
      } catch (err) {
        s.loadError = { message: (err as Error).message, traceback: (err as RequestError).traceback };
        return false;
      } finally {
        s.loading = false;
        rerender();
      }
    },
    play: async () => {
      const s = store.current;
      s.cursor = null;
      if (s.status?.done && !s.status.autoReset) await call('reset');
      setPlaying(true);
      rerender();
      await call('play');
    },
    pause: async () => {
      setPlaying(false);
      rerender();
      await call('pause');
    },
    togglePlay: async () => {
      if (store.current.status?.playing) await actions.pause();
      else await actions.play();
    },
    stepForward: async () => {
      const s = store.current;
      const last = s.timeline.length - 1;
      if (s.status?.playing) await actions.pause();
      if (s.cursor !== null && s.cursor < last) {
        s.cursor = s.cursor + 1 >= last ? null : s.cursor + 1;
        rerender();
        return;
      }
      s.cursor = null;
      await call('step');
    },
    stepBack: async () => {
      const s = store.current;
      if (!s.timeline.length) return;
      if (s.status?.playing) await actions.pause();
      const current = s.cursor ?? s.timeline.length - 1;
      s.cursor = Math.max(0, current - 1);
      rerender();
    },
    reset: async () => {
      store.current.cursor = null;
      await call('reset');
    },
    setSpeed: async (speed: number) => {
      const s = store.current;
      if (s.status) s.status = { ...s.status, speed };
      rerender();
      await call('set_speed', { speed });
    },
    setAutoReset: async (value: boolean) => {
      const s = store.current;
      if (s.status) s.status = { ...s.status, autoReset: value };
      rerender();
      await call('set_auto_reset', { value });
    },
    setDeterministic: async (value: boolean) => {
      const s = store.current;
      if (s.agent) s.agent = { ...s.agent, deterministic: value };
      rerender();
      await call('set_deterministic', { value });
    },
    seek: (index: number | null) => {
      const s = store.current;
      if (index !== null && index >= s.timeline.length - 1) index = null;
      if (index !== null && s.status?.playing) void actions.pause();
      s.cursor = index;
      rerender();
    },
    dismissError: () => {
      store.current.error = null;
      rerender();
    },
    dismissWarnings: () => {
      store.current.warnings = [];
      rerender();
    },
    clearLoadError: () => {
      store.current.loadError = null;
      rerender();
    },
  };

  return { state: store.current, actions };
}
