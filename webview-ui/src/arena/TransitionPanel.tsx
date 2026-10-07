import { useState } from 'react';
import type { AgentDesc, Inspection, TimelineEntry } from '../types';
import { fmt, fmtSigned, toNumber } from '../format';
import { ActionView } from './ActionView';
import { ObservationTable, StructuredValue } from './ObservationTable';

interface Props {
  entry: TimelineEntry | undefined;
  previous: TimelineEntry | undefined;
  inspection: Inspection | null;
  agent: AgentDesc | null;
  scale: number[];
  onDeterministic: (value: boolean) => void;
}

/** The step debugger: s_t → a_t → (r_t, done) → s_{t+1} for the selected timestep. */
export function TransitionPanel({ entry, previous, inspection, agent, scale, onDeterministic }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const labels = inspection?.observationLabels ?? [];
  const obsSpace = inspection?.observationSpace;

  if (!entry) {
    return (
      <aside className="side">
        <div className="card">
          <h3>Step debugger</h3>
          <p className="muted">Launch an environment to see each transition: state → action → reward → next state.</p>
        </div>
      </aside>
    );
  }

  const isReset = entry.step === 0;
  const flagged = new Set(entry.anomalies.filter((a) => a.index !== undefined).map((a) => a.index!));
  const reward = toNumber(entry.reward ?? 0);
  const infoKeys = entry.info && typeof entry.info === 'object' ? Object.keys(entry.info as object) : [];

  return (
    <aside className="side">
      <div className="card agent-card">
        <div className="agent-line">
          <span className="agent-icon">{agent?.kind === 'sb3' ? '🧠' : agent?.kind === 'replay' ? '🎥' : '🎲'}</span>
          <div>
            <div className="agent-name">{agent?.name ?? '—'}</div>
            <div className="muted small">
              {agent?.algorithm
                ? `${agent.algorithm} · Stable-Baselines3`
                : agent?.kind === 'replay'
                  ? `replays ${agent.totalSteps ?? 0} recorded actions`
                  : 'samples action_space uniformly'}
            </div>
          </div>
          {agent?.kind === 'sb3' && (
            <label className="field-check small">
              <input type="checkbox" checked={agent.deterministic ?? true} onChange={(e) => onDeterministic(e.target.checked)} />
              deterministic
            </label>
          )}
        </div>
      </div>

      {isReset ? (
        <div className="card">
          <h3>
            <span className="step-badge">s₀</span> Initial state <span className="muted small">after reset()</span>
          </h3>
          <ObservationTable obs={entry.obs} labels={labels} space={obsSpace} scale={scale} highlight={flagged} />
        </div>
      ) : (
        <>
          <div className="card">
            <h3>
              <span className="step-badge">s{sub(entry.step - 1)}</span> State
            </h3>
            {previous ? (
              <ObservationTable obs={previous.obs} labels={labels} space={obsSpace} scale={scale} />
            ) : (
              <div className="muted">Earlier steps were trimmed from the buffer.</div>
            )}
          </div>

          <div className="flow-arrow">↓ agent observes s{sub(entry.step - 1)} and acts</div>

          <div className="card">
            <h3>
              <span className="step-badge accent">a{sub(entry.step - 1)}</span> Agent decision
            </h3>
            <ActionView
              action={entry.action}
              info={entry.actionInfo}
              labels={inspection?.actionLabels ?? []}
              space={inspection?.actionSpace}
              agent={agent}
            />
          </div>

          <div className="flow-arrow">↓ env.step(a)</div>

          <div className="card">
            <h3>
              <span className="step-badge">r{sub(entry.step)}</span> Environment response
            </h3>
            <div className="response">
              <div className={`reward-big ${reward > 0 ? 'pos' : reward < 0 ? 'neg' : ''}`}>{fmtSigned(entry.reward)}</div>
              <div className="response-meta">
                <span>
                  Return <b>{fmt(entry.totalReward, 3)}</b>
                </span>
                <span className={`flag-chip ${entry.terminated ? 'on' : ''}`}>terminated {entry.terminated ? '✓' : '✗'}</span>
                <span className={`flag-chip ${entry.truncated ? 'on warn' : ''}`}>truncated {entry.truncated ? '✓' : '✗'}</span>
              </div>
            </div>
            {infoKeys.length > 0 && (
              <>
                <button className="link" onClick={() => setShowInfo(!showInfo)}>
                  {showInfo ? '▾' : '▸'} info ({infoKeys.join(', ')})
                </button>
                {showInfo && <pre className="info-json">{JSON.stringify(entry.info, null, 2)}</pre>}
              </>
            )}
          </div>

          <div className="flow-arrow">↓</div>

          <div className="card">
            <h3>
              <span className="step-badge">s{sub(entry.step)}</span> Next state <span className="muted small">Δ vs previous</span>
            </h3>
            {entry.obs.kind === 'vector' || entry.obs.kind === 'scalar' || entry.obs.kind === 'tuple' ? (
              <ObservationTable
                obs={entry.obs}
                previous={previous?.obs}
                labels={labels}
                space={obsSpace}
                scale={scale}
                highlight={flagged}
              />
            ) : (
              <StructuredValue value={entry.obs} />
            )}
          </div>
        </>
      )}

      {entry.anomalies.length > 0 && (
        <div className="card card-alert">
          <h3>Issues at this step</h3>
          {entry.anomalies.map((a, i) => (
            <div key={i} className={`issue ${a.level}`}>
              {a.level === 'critical' ? '🚨' : '⚠️'} {a.message}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
function sub(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUBSCRIPTS[Number(d)] ?? d)
    .join('');
}
