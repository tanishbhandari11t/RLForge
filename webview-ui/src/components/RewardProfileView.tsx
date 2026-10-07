import type { Histogram, RewardProfile } from '../types';
import { fmt } from '../format';

function HistogramChart({ hist, label }: { hist: Histogram; label: string }) {
  const max = Math.max(1, ...hist.counts);
  const n = hist.counts.length;
  return (
    <div className="histogram">
      <svg viewBox={`0 0 ${n} 30`} preserveAspectRatio="none">
        {hist.counts.map((c, i) => {
          const h = (c / max) * 28;
          return <rect key={i} x={i + 0.08} width={0.84} y={30 - h} height={Math.max(h, c ? 0.6 : 0)} className="hist-bar" />;
        })}
      </svg>
      <div className="histogram-axis">
        <span>{fmt(hist.edges[0], 3)}</span>
        <span className="muted">{label}</span>
        <span>{fmt(hist.edges[hist.edges.length - 1], 3)}</span>
      </div>
    </div>
  );
}

function insights(p: RewardProfile): { level: 'ok' | 'warn' | 'info'; text: string }[] {
  const out: { level: 'ok' | 'warn' | 'info'; text: string }[] = [];
  if (!p.steps) return out;
  if (p.invalid) out.push({ level: 'warn', text: `${p.invalid} reward(s) were NaN/Inf or not numbers.` });
  if (p.distinct === 1) {
    out.push({ level: 'info', text: `Constant reward (${fmt(p.min!)} every step): the only signal is episode length (survival-style).` });
  } else if (p.sparsity != null && p.sparsity >= 0.95 && p.topValues?.length) {
    const top = p.topValues[0];
    out.push({
      level: 'warn',
      text: `Sparse: ${(100 * top.share).toFixed(1)}% of random steps give ${fmt(top.value)}. A random policy rarely sees anything else, so exploration will be hard. Consider reward shaping or curriculum.`,
    });
  } else if (p.sparsity != null && p.sparsity >= 0.8) {
    out.push({ level: 'info', text: `Fairly sparse: the most common reward covers ${(100 * p.sparsity).toFixed(0)}% of steps.` });
  } else {
    out.push({ level: 'ok', text: 'Dense reward: a random policy already sees varied feedback.' });
  }
  if ((p.negative ?? 0) > 0.9) out.push({ level: 'info', text: 'Mostly negative rewards: agents may learn to end episodes early if termination stops the penalty.' });
  if (p.max != null && p.min != null && Math.max(Math.abs(p.max), Math.abs(p.min)) > 1000)
    out.push({ level: 'warn', text: 'Very large reward magnitudes. Consider normalising (e.g. VecNormalize) to stabilise value learning.' });
  if (p.returnStd != null && p.returnMean != null && p.returnStd < 1e-9 && (p.episodes ?? 0) > 3)
    out.push({ level: 'info', text: 'Every random episode got the same return: the reward does not distinguish behaviours under a random policy.' });
  return out;
}

export function RewardProfileView({ profile }: { profile: RewardProfile }) {
  if (!profile.steps) return <p className="muted">No rewards collected.</p>;
  const p = profile;
  return (
    <div className="reward-profile">
      <div className="stats">
        <div>
          <span>steps</span>
          <b>{p.steps.toLocaleString()}</b>
        </div>
        <div>
          <span>mean ± std</span>
          <b>
            {fmt(p.mean!, 3)} ± {fmt(p.std!, 3)}
          </b>
        </div>
        <div>
          <span>range</span>
          <b>
            [{fmt(p.min!, 3)}, {fmt(p.max!, 3)}]
          </b>
        </div>
        <div>
          <span>distinct values</span>
          <b>{p.distinct ?? 'many'}</b>
        </div>
        {p.episodes != null && (
          <div>
            <span>random return</span>
            <b>
              {fmt(p.returnMean!, 3)} ± {fmt(p.returnStd!, 3)}
            </b>
          </div>
        )}
        {p.lengthMean != null && (
          <div>
            <span>episode length</span>
            <b>{fmt(p.lengthMean, 1)}</b>
          </div>
        )}
      </div>

      <div className="sign-bar" title="Share of positive / zero / negative rewards">
        <div className="sign-pos" style={{ width: `${100 * (p.positive ?? 0)}%` }} />
        <div className="sign-zero" style={{ width: `${100 * (p.zero ?? 0)}%` }} />
        <div className="sign-neg" style={{ width: `${100 * (p.negative ?? 0)}%` }} />
      </div>
      <div className="small muted sign-legend">
        <span>▲ {(100 * (p.positive ?? 0)).toFixed(1)}% positive</span>
        <span>● {(100 * (p.zero ?? 0)).toFixed(1)}% zero</span>
        <span>▼ {(100 * (p.negative ?? 0)).toFixed(1)}% negative</span>
      </div>

      <div className="insights">
        {insights(p).map((i, k) => (
          <div key={k} className={`insight insight-${i.level}`}>
            {i.level === 'ok' ? '✓' : i.level === 'warn' ? '⚠' : 'ℹ'} {i.text}
          </div>
        ))}
      </div>

      {p.topValues && p.topValues.length > 0 && p.topValues.length <= 12 && (
        <table className="value-table">
          <thead>
            <tr>
              <th>reward</th>
              <th>share of steps</th>
              <th>count</th>
            </tr>
          </thead>
          <tbody>
            {p.topValues.map((v) => (
              <tr key={v.value}>
                <td>{fmt(v.value, 4)}</td>
                <td>
                  <div className="share-bar">
                    <div style={{ width: `${Math.max(1, 100 * v.share)}%` }} />
                    <span>{(100 * v.share).toFixed(v.share < 0.01 ? 2 : 1)}%</span>
                  </div>
                </td>
                <td className="muted">{v.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.histogram && <HistogramChart hist={p.histogram} label="reward per step" />}
      {p.returnHistogram && <HistogramChart hist={p.returnHistogram} label="episode return (random policy)" />}
    </div>
  );
}
