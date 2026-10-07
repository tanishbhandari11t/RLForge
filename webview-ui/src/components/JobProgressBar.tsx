import type { JobProgress } from '../types';

export function JobProgressBar({ progress, onCancel, children }: { progress: JobProgress | null; onCancel: () => void; children?: React.ReactNode }) {
  const pct = Math.round(100 * Math.min(1, Math.max(0, progress?.fraction ?? 0)));
  return (
    <div className="card job-progress">
      <div className="job-progress-head">
        <span className="spinner" />
        <b>{progress?.stage ?? 'Starting'}…</b>
        <span className="muted">{pct}%</span>
        <button className="btn btn-ghost btn-small" onClick={onCancel}>
          Stop
        </button>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {children}
    </div>
  );
}
