import type { ActionInfo, AgentDesc, Encoded, SpaceDesc } from '../types';
import { actionLabel, describeEncoded, fmt, toNumber } from '../format';

interface Props {
  action: Encoded | undefined;
  info: ActionInfo | undefined;
  labels: string[];
  space: SpaceDesc | undefined;
  agent: AgentDesc | null;
}

export function ActionView({ action, info, labels, space, agent }: Props) {
  if (!info || !action) return <div className="muted">No action yet — this is the initial state after reset().</div>;
  const start = space?.start ?? 0;

  if (info.type === 'discrete' && info.probs) {
    const max = Math.max(...info.probs);
    const heading =
      info.mode === 'q' ? 'Q-values (softmax)' : info.mode === 'uniform' ? 'Uniform random policy' : 'Action probabilities π(a|s)';
    return (
      <div className="action-view">
        <div className="subhead">{heading}</div>
        {info.probs.map((p, i) => {
          const selected = i === info.selected;
          return (
            <div key={i} className={`prob-row ${selected ? 'selected' : ''}`}>
              <span className="prob-label" title={actionLabel(labels, i, start)}>
                {selected ? '▸ ' : ''}
                {actionLabel(labels, i, start)}
              </span>
              <span className="prob-bar">
                <span className={`prob-fill ${p === max ? 'top' : ''}`} style={{ width: `${Math.max(p * 100, 0.5)}%` }} />
              </span>
              <span className="prob-value">
                {info.mode === 'q' && info.qValues ? fmt(info.qValues[i], 2) : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`}
              </span>
            </div>
          );
        })}
        <div className="kv-inline">
          <span>
            Selected <b>{actionLabel(labels, info.selected ?? 0, start)}</b>
          </span>
          {info.entropy !== undefined && <span>H = {fmt(info.entropy, 3)}</span>}
          {info.value !== undefined && <span>V(s) = {fmt(info.value, 3)}</span>}
        </div>
        {agent?.kind === 'sb3' && agent.deterministic === false && (
          <div className="hint">Stochastic: the action is sampled, so it may not be the most likely one.</div>
        )}
      </div>
    );
  }

  if (info.type === 'continuous' && info.values) {
    return (
      <div className="action-view">
        <div className="subhead">Continuous action</div>
        {info.values.map((raw, i) => {
          const v = toNumber(raw);
          const lo = toNumber(info.low?.[i] ?? -1);
          const hi = toNumber(info.high?.[i] ?? 1);
          const span = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : [-1, 1];
          const pos = ((Math.min(Math.max(v, span[0]), span[1]) - span[0]) / (span[1] - span[0])) * 100;
          const mean = info.mean ? toNumber(info.mean[i]) : NaN;
          const std = info.std ? toNumber(info.std[i]) : NaN;
          const band =
            Number.isFinite(mean) && Number.isFinite(std)
              ? {
                  left: ((Math.max(mean - std, span[0]) - span[0]) / (span[1] - span[0])) * 100,
                  right: ((Math.min(mean + std, span[1]) - span[0]) / (span[1] - span[0])) * 100,
                }
              : null;
          return (
            <div key={i} className="cont-row">
              <span className="prob-label">{labels[i] ?? `a[${i}]`}</span>
              <span className="cont-track">
                {band && <span className="cont-band" style={{ left: `${band.left}%`, width: `${band.right - band.left}%` }} />}
                <span className="cont-zero" style={{ left: `${((0 - span[0]) / (span[1] - span[0])) * 100}%` }} />
                <span className="cont-knob" style={{ left: `${pos}%` }} />
              </span>
              <span className="prob-value">{fmt(raw, 3)}</span>
            </div>
          );
        })}
        <div className="kv-inline">
          {info.std && <span>band = policy mean ± σ</span>}
          {info.value !== undefined && <span>V(s) = {fmt(info.value, 3)}</span>}
          {info.q !== undefined && <span>Q(s,a) = {fmt(info.q, 3)}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="action-view">
      <code>{describeEncoded(action, labels, start)}</code>
    </div>
  );
}
