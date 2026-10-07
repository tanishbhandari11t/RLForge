import { useEffect, useState } from 'react';
import type { Inspection, PanelCommand, ProjectInfo, SpaceDesc } from '../types';
import { basename, fmt } from '../format';
import { request, RequestError } from '../vscode';
import { StructuredValue, ObservationTable } from '../arena/ObservationTable';
import { InstallHint } from '../components/InstallHint';
import { POPULAR_ENVS } from '../arena/SetupBar';

interface Props {
  project: ProjectInfo | null;
  command: { seq: number; command: PanelCommand } | null;
  registeredEnvs: string[];
  currentEnv: string | null;
  onWatch: (env: string) => void;
}

export function InspectorView({ project, command, registeredEnvs, currentEnv, onWatch }: Props) {
  const [env, setEnv] = useState(currentEnv ?? 'CartPole-v1');
  const [data, setData] = useState<Inspection | null>(null);
  const [error, setError] = useState<{ message: string; traceback?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const inspect = async (target = env) => {
    if (!target.trim()) return;
    setEnv(target);
    setLoading(true);
    setError(null);
    try {
      setData(await request<Inspection>('inspect', { env: target.trim() }));
    } catch (err) {
      setData(null);
      setError({ message: (err as Error).message, traceback: (err as RequestError).traceback });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (command?.command.tab === 'inspector' && command.command.env) void inspect(command.command.env);
  }, [command?.seq]);

  const suggestions = Array.from(new Set([...(project?.environments ?? []).map((e) => e.spec), ...POPULAR_ENVS, ...registeredEnvs]));

  return (
    <div className="inspector">
      <form
        className="setup"
        onSubmit={(e) => {
          e.preventDefault();
          void inspect();
        }}
      >
        <label className="field field-env">
          <span>Environment</span>
          <input list="rlforge-inspect-envs" value={env} spellCheck={false} onChange={(e) => setEnv(e.target.value)} />
          <datalist id="rlforge-inspect-envs">
            {suggestions.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : '🔍'} Inspect
        </button>
        {data && (
          <button type="button" className="btn" onClick={() => onWatch(data.envId)}>
            ▶ Watch in Arena
          </button>
        )}
      </form>

      {error && (
        <div className="alert alert-error">
          <div className="alert-title">Could not inspect {env}</div>
          <pre>{error.message}</pre>
          <InstallHint message={error.message} />
          {error.traceback && (
            <details>
              <summary>Traceback</summary>
              <pre>{error.traceback}</pre>
            </details>
          )}
        </div>
      )}

      {!data && !error && !loading && (
        <div className="card">
          <h3>Environment Inspector</h3>
          <p className="muted">
            Enter a registered Gymnasium id or <code>path/to/file.py:ClassName</code> to see its observation and action spaces,
            labels, reward range, episode limits, render modes and wrapper stack.
          </p>
        </div>
      )}

      {data && (
        <div className="inspector-grid">
          <div className="card span-2">
            <div className="insp-head">
              <div>
                <h2>{data.spec?.id ?? basename(data.envId)}</h2>
                <code className="muted">{data.envClass}</code>
              </div>
              {data.sourceFile && (
                <button
                  className="btn btn-ghost"
                  onClick={() => void request('ui:openFile', { file: data.sourceFile, line: data.sourceLine ?? 1 })}
                >
                  📄 Open source
                </button>
              )}
            </div>
            {data.description && <p className="desc">{data.description}</p>}
          </div>

          <div className="card">
            <h3>🧠 Observation space</h3>
            <SpaceView space={data.observationSpace} labels={data.observationLabels} />
          </div>
          <div className="card">
            <h3>🎮 Action space</h3>
            <SpaceView space={data.actionSpace} labels={data.actionLabels} isAction />
          </div>

          <div className="card">
            <h3>📋 Episode & reward</h3>
            <dl className="kv">
              <dt>Max episode steps</dt>
              <dd>{data.spec?.maxEpisodeSteps ?? 'unlimited / not registered'}</dd>
              <dt>Reward threshold</dt>
              <dd>{data.spec?.rewardThreshold ?? '—'}</dd>
              <dt>Reward range</dt>
              <dd>{data.rewardRange ? `[${data.rewardRange.map((v) => fmt(v)).join(', ')}]` : '—'}</dd>
              <dt>Nondeterministic</dt>
              <dd>{data.spec ? (data.spec.nondeterministic ? 'yes' : 'no') : '—'}</dd>
              <dt>Entry point</dt>
              <dd>
                <code>{data.spec?.entryPoint ?? data.envId}</code>
              </dd>
              {data.spec && Object.keys(data.spec.kwargs).length > 0 && (
                <>
                  <dt>kwargs</dt>
                  <dd>
                    <code>{JSON.stringify(data.spec.kwargs)}</code>
                  </dd>
                </>
              )}
            </dl>
          </div>

          <div className="card">
            <h3>🎥 Rendering & wrappers</h3>
            <dl className="kv">
              <dt>Render modes</dt>
              <dd>{data.renderModes.length ? data.renderModes.join(', ') : 'none declared'}</dd>
              <dt>Used by RLForge</dt>
              <dd>{data.renderMode ?? 'no rendering'}</dd>
              <dt>Render FPS</dt>
              <dd>{data.renderFps ?? '—'}</dd>
            </dl>
            <div className="wrappers">
              {data.wrappers.map((w, i) => (
                <span key={i} className="wrapper-chip">
                  {w}
                  {i < data.wrappers.length - 1 && <span className="muted"> ›</span>}
                </span>
              ))}
            </div>
          </div>

          <div className="card span-2">
            <h3>🔬 Sample observation <span className="muted small">reset(seed=0)</span></h3>
            {data.sampleObservation?.kind === 'error' ? (
              <div className="issue critical">{data.sampleObservation.repr}</div>
            ) : data.sampleObservation ? (
              ['vector', 'scalar', 'tuple'].includes(data.sampleObservation.kind) ? (
                <ObservationTable obs={data.sampleObservation} labels={data.observationLabels} space={data.observationSpace} scale={[]} />
              ) : (
                <StructuredValue value={data.sampleObservation} />
              )
            ) : (
              '—'
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SpaceView({ space, labels, isAction }: { space: SpaceDesc; labels: string[]; isAction?: boolean }) {
  return (
    <div className="space">
      <code className="space-repr">{space.repr}</code>
      {space.type === 'Discrete' && !isAction && (space.n ?? 0) > 16 && (
        <div className="muted small">{space.n} discrete states</div>
      )}
      {space.type === 'Discrete' && (isAction || (space.n ?? 0) <= 16) && (
        <div className="space-list">
          {Array.from({ length: Math.min(space.n ?? 0, 64) }, (_, i) => (
            <div key={i} className="space-item">
              <span className="idx">{i + (space.start ?? 0)}</span>
              <span>{labels[i] ?? (isAction ? `Action ${i + (space.start ?? 0)}` : `State ${i + (space.start ?? 0)}`)}</span>
            </div>
          ))}
          {(space.n ?? 0) > 64 && <div className="muted small">… {space.n! - 64} more</div>}
        </div>
      )}
      {space.type === 'Box' && Array.isArray(space.low) && Array.isArray(space.high) && (
        <table className="space-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{isAction ? 'Dimension' : 'Feature'}</th>
              <th>low</th>
              <th>high</th>
            </tr>
          </thead>
          <tbody>
            {space.low.map((lo, i) => (
              <tr key={i}>
                <td className="idx">{i}</td>
                <td>{labels[i] ?? (isAction ? `a[${i}]` : `obs[${i}]`)}</td>
                <td>{fmt(lo, 3)}</td>
                <td>{fmt((space.high as typeof space.low)[i], 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {space.type === 'Box' && !Array.isArray(space.low) && space.low && (
        <dl className="kv">
          <dt>shape</dt>
          <dd>{space.shape?.join(' × ')}</dd>
          <dt>dtype</dt>
          <dd>{space.dtype}</dd>
          <dt>range</dt>
          <dd>
            [{fmt(space.low.min)}, {fmt((space.high as { max: number }).max)}]
          </dd>
        </dl>
      )}
      {space.type === 'Box' && (
        <div className="muted small">
          dtype {space.dtype} · {space.boundedBelow && space.boundedAbove ? 'bounded' : 'unbounded'}
        </div>
      )}
      {space.type === 'MultiDiscrete' && <div className="muted">nvec = [{space.nvec?.join(', ')}]</div>}
      {(space.type === 'Dict' || space.type === 'Tuple') && space.spaces && (
        <div className="nested">
          {Object.entries(space.spaces).map(([k, sub]) => (
            <div key={k} className="nested-item">
              <span className="obs-label">{space.type === 'Tuple' ? labels[Number(k)] ?? `[${k}]` : k}</span>
              <SpaceView space={sub} labels={[]} isAction={isAction} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
