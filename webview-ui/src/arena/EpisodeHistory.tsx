import type { EpisodeSummary } from '../types';
import { fmt, toNumber } from '../format';
import type { AnomalyStat } from './useArena';

export function EpisodeHistory({ history, rewardThreshold }: { history: EpisodeSummary[]; rewardThreshold: number | null }) {
  const returns = history
    .slice()
    .reverse()
    .map((h) => toNumber(h.return))
    .filter(Number.isFinite);
  const n = returns.length;
  const mean = n ? returns.reduce((a, b) => a + b, 0) / n : NaN;
  const best = n ? Math.max(...returns) : NaN;
  const meanLen = history.length ? history.reduce((a, h) => a + h.length, 0) / history.length : NaN;
  const solved = rewardThreshold !== null && n ? returns.filter((r) => r >= rewardThreshold).length / n : null;

  const lo = Math.min(...returns, rewardThreshold ?? Infinity);
  const hi = Math.max(...returns, rewardThreshold ?? -Infinity);
  const span = hi - lo || 1;
  const w = 200;
  const h = 44;
  const pts = returns.map((r, i) => `${n === 1 ? w / 2 : (i / (n - 1)) * w},${h - ((r - lo) / span) * (h - 6) - 3}`).join(' ');
  const thresholdY = rewardThreshold !== null ? h - ((rewardThreshold - lo) / span) * (h - 6) - 3 : null;

  return (
    <div className="card">
      <h3>Episodes</h3>
      {history.length === 0 ? (
        <p className="muted">Completed episodes appear here with their return and length.</p>
      ) : (
        <>
          <div className="stats">
            <div>
              <span>Episodes</span>
              <b>{history.length}</b>
            </div>
            <div>
              <span>Mean return</span>
              <b>{fmt(mean, 2)}</b>
            </div>
            <div>
              <span>Best</span>
              <b>{fmt(best, 2)}</b>
            </div>
            <div>
              <span>Mean length</span>
              <b>{fmt(meanLen, 1)}</b>
            </div>
            {solved !== null && (
              <div title={`Share of episodes with return ≥ reward threshold (${rewardThreshold})`}>
                <span>Solved</span>
                <b>{Math.round(solved * 100)}%</b>
              </div>
            )}
          </div>
          {n > 1 && (
            <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
              {thresholdY !== null && <line x1={0} x2={w} y1={thresholdY} y2={thresholdY} className="threshold" />}
              <polyline points={pts} />
            </svg>
          )}
          <div className="episode-list">
            {history.slice(0, 50).map((e) => (
              <div key={e.episode} className="episode-row">
                <span className="muted">#{e.episode}</span>
                <span className={e.terminated ? 'tag tag-term' : 'tag tag-trunc'}>{e.terminated ? 'terminated' : 'truncated'}</span>
                <span>
                  Σ <b>{fmt(e.return, 2)}</b>
                </span>
                <span className="muted">{e.length} steps</span>
                <span className="muted">seed {e.seed ?? '—'}</span>
                {e.anomalies > 0 && <span className="tag tag-bad">{e.anomalies} issues</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function HealthPanel({ anomalies }: { anomalies: Record<string, AnomalyStat> }) {
  const list = Object.values(anomalies).sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === 'critical' ? -1 : 1));
  return (
    <div className="card">
      <h3>Environment health</h3>
      {list.length === 0 ? (
        <div className="healthy">
          <span className="ok-dot" /> No NaN/Inf, space violations or exploding values seen so far.
        </div>
      ) : (
        list.map((a) => (
          <div key={a.code} className={`issue ${a.level}`}>
            <div>
              {a.level === 'critical' ? '🚨' : '⚠️'} <b>{a.code.replace(/_/g, ' ')}</b> × {a.count}
            </div>
            <div className="muted small">
              first: {a.message} (episode {a.episode}, step {a.step})
            </div>
          </div>
        ))
      )}
    </div>
  );
}
