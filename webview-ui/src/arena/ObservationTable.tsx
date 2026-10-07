import { useState } from 'react';
import type { Encoded, SpaceDesc } from '../types';
import { boundsOf, flatten, fmt, isBad, toNumber } from '../format';

interface Props {
  obs: Encoded | undefined;
  previous?: Encoded;
  labels: string[];
  space?: SpaceDesc;
  scale: number[];
  highlight?: Set<number>;
}

const COLLAPSED_ROWS = 12;

export function ObservationTable({ obs, previous, labels, space, scale, highlight }: Props) {
  const [expanded, setExpanded] = useState(false);
  const rows = flatten(obs, labels);
  const prevRows = flatten(previous, labels);

  if (!obs) return <div className="muted">—</div>;
  if (!rows) return <StructuredValue value={obs} />;

  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  return (
    <div className="obs-table">
      {visible.map((row) => {
        const v = toNumber(row.value);
        const bounds = boundsOf(space, row.index);
        let frac: number;
        let zero: number;
        if (bounds) {
          const [lo, hi] = bounds;
          zero = lo < 0 && hi > 0 ? (0 - lo) / (hi - lo) : lo >= 0 ? 0 : 1;
          frac = (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo);
        } else {
          const s = Math.max(scale[row.index] ?? 1, 1e-9);
          zero = 0.5;
          frac = 0.5 + Math.max(-1, Math.min(1, v / s)) / 2;
        }
        const left = Math.min(zero, frac) * 100;
        const width = Math.abs(frac - zero) * 100;
        const prev = prevRows?.[row.index];
        const delta = prev ? v - toNumber(prev.value) : NaN;
        const bad = isBad(row.value);
        return (
          <div key={row.index} className={`obs-row ${bad ? 'bad' : ''} ${highlight?.has(row.index) ? 'flag' : ''}`}>
            <span className="obs-label" title={row.label}>
              {row.label}
            </span>
            <span className="obs-bar">
              <span className="obs-zero" style={{ left: `${zero * 100}%` }} />
              {Number.isFinite(v) && (
                <span className={`obs-fill ${v < 0 ? 'neg' : ''}`} style={{ left: `${left}%`, width: `${Math.max(width, 0.8)}%` }} />
              )}
            </span>
            <span className="obs-value">{fmt(row.value)}</span>
            {prevRows && (
              <span className={`obs-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
                {Number.isFinite(delta) && Math.abs(delta) > 1e-9 ? `${delta > 0 ? '▲' : '▼'} ${fmt(Math.abs(delta), 3)}` : ''}
              </span>
            )}
          </div>
        );
      })}
      {rows.length > COLLAPSED_ROWS && (
        <button className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${rows.length} values`}
        </button>
      )}
    </div>
  );
}

export function StructuredValue({ value, depth = 0 }: { value: Encoded; depth?: number }) {
  switch (value.kind) {
    case 'tensor':
      return (
        <div className="tensor">
          <code>
            {value.dtype} [{value.shape.join(' × ')}]
          </code>
          <span>
            min {fmt(value.min ?? null)} · max {fmt(value.max ?? null)} · mean {fmt(value.mean ?? null)}
          </span>
          {(value.nanCount ?? 0) + (value.infCount ?? 0) > 0 && (
            <span className="bad">
              {value.nanCount} NaN · {value.infCount} Inf
            </span>
          )}
        </div>
      );
    case 'dict':
      return (
        <div className="structured" style={{ marginLeft: depth ? 10 : 0 }}>
          {Object.entries(value.items).map(([k, v]) => (
            <div key={k} className="structured-row">
              <span className="obs-label">{k}</span>
              <StructuredValue value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      );
    case 'tuple':
      return (
        <div className="structured" style={{ marginLeft: depth ? 10 : 0 }}>
          {value.items.map((v, i) => (
            <div key={i} className="structured-row">
              <span className="obs-label">[{i}]</span>
              <StructuredValue value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      );
    case 'scalar':
      return <code className={isBad(value.value) ? 'bad' : ''}>{fmt(value.value)}</code>;
    case 'vector':
      return <code>[{value.values.map((v) => fmt(v, 3)).join(', ')}]</code>;
    default:
      return <code>{value.repr}</code>;
  }
}
