import { useMemo } from 'react';
import type { TimelineEntry } from '../types';
import { toNumber } from '../format';

interface Props {
  timeline: TimelineEntry[];
  length: number;
  cursor: number | null;
  onSeek: (index: number | null) => void;
}

const MAX_BARS = 400;

/** Reward-per-step strip with anomaly markers and a scrubber over the current episode. */
export function Timeline({ timeline, length, cursor, onSeek }: Props) {
  const last = Math.max(0, length - 1);
  const index = cursor ?? last;

  const bars = useMemo(() => {
    const n = timeline.length;
    if (n <= 1) return [];
    const bucket = Math.max(1, Math.ceil((n - 1) / MAX_BARS));
    const out: { x: number; value: number; bad: boolean; critical: boolean; ended: boolean }[] = [];
    for (let i = 1; i < n; i += bucket) {
      let sum = 0;
      let bad = false;
      let critical = false;
      let ended = false;
      for (let j = i; j < Math.min(n, i + bucket); j++) {
        const e = timeline[j];
        const r = toNumber(e.reward ?? 0);
        if (Number.isFinite(r)) sum += r;
        else bad = true;
        if (e.anomalies.some((a) => a.level === 'critical')) critical = true;
        if (e.terminated || e.truncated) ended = true;
      }
      out.push({ x: i, value: sum, bad, critical, ended });
    }
    return out;
    // timeline is mutated in place; length is the change signal
  }, [timeline, length]);

  const maxAbs = Math.max(1e-9, ...bars.map((b) => Math.abs(b.value)));
  const width = Math.max(1, last);
  const barW = Math.max(0.6, width / Math.max(1, bars.length) - 0.2);

  return (
    <div className="timeline">
      <svg className="timeline-strip" viewBox={`0 0 ${width} 40`} preserveAspectRatio="none">
        <line x1={0} x2={width} y1={20} y2={20} className="axis" />
        {bars.map((b) => {
          const h = (Math.abs(b.value) / maxAbs) * 18;
          return (
            <rect
              key={b.x}
              x={b.x - 1}
              width={barW}
              y={b.value >= 0 ? 20 - h : 20}
              height={Math.max(h, 0.6)}
              className={b.critical || b.bad ? 'bar-critical' : b.value >= 0 ? 'bar-pos' : 'bar-neg'}
            />
          );
        })}
        {bars
          .filter((b) => b.critical)
          .map((b) => (
            <rect key={`c${b.x}`} x={b.x - 1} width={Math.max(barW, width / 200)} y={0} height={3} className="bar-critical" />
          ))}
        <line x1={index} x2={index} y1={0} y2={40} className="cursor" />
      </svg>
      <input
        type="range"
        className="scrubber"
        min={0}
        max={last}
        value={index}
        disabled={length <= 1}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Episode timeline"
      />
      <div className="timeline-labels">
        <span>step 0</span>
        <span>reward per step · drag to review any decision</span>
        <span>step {timeline[last]?.step ?? 0}</span>
      </div>
    </div>
  );
}
