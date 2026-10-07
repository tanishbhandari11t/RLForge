import { useEffect, useState } from 'react';
import type { FuzzGroup, FuzzReport, FuzzTotals, PanelCommand, ProjectInfo, ReplayRequest, RewardProfile, Settings } from '../types';
import { basename } from '../format';
import { request } from '../vscode';
import { useJob } from '../jobs/useJob';
import { EnvPicker } from '../components/EnvPicker';
import { JobProgressBar } from '../components/JobProgressBar';
import { InstallHint } from '../components/InstallHint';

interface Props {
  project: ProjectInfo | null;
  registeredEnvs: string[];
  settings: Settings;
  command: { seq: number; command: PanelCommand } | null;
  defaultEnv: string | null;
  onReplay: (replay: ReplayRequest) => void;
  onProfile: (envId: string, source: string, profile: RewardProfile) => void;
}

const EPISODES = [100, 1000, 10000];

export function FuzzerView({ project, registeredEnvs, settings, command, defaultEnv, onReplay, onProfile }: Props) {
  const [env, setEnv] = useState(defaultEnv ?? 'CartPole-v1');
  const [episodes, setEpisodes] = useState(1000);
  const [maxSteps, setMaxSteps] = useState('1000');
  const [seed, setSeed] = useState(String(settings.defaultSeed));
  const [strategy, setStrategy] = useState<'uniform' | 'boundary'>('uniform');
  const job = useJob<FuzzReport>((r) => onProfile(r.envId, `fuzzing ${r.totals.episodes} episodes`, r.rewardProfile));

  const run = (target = env) => {
    if (!target.trim()) return;
    setEnv(target);
    void job.start('start_fuzz', {
      env: target.trim(),
      episodes,
      maxSteps: Number(maxSteps) || 1000,
      seed: Number(seed) || 0,
      strategy,
      timeBudget: 600,
    });
  };

  useEffect(() => {
    const c = command?.command;
    if (c?.tab !== 'fuzzer') return;
    if (c.env) setEnv(c.env);
    if (c.run && c.env) run(c.env);
  }, [command?.seq]);

  const live = job.running ? (job.progress as unknown as Partial<FuzzTotals> & { groups?: number }) : null;
  const report = job.result;

  return (
    <div className="tool-view">
      <form
        className="setup"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <EnvPicker id="rlforge-fuzz-envs" value={env} onChange={setEnv} project={project} registeredEnvs={registeredEnvs} />
        <label className="field">
          <span>Episodes</span>
          <select value={episodes} onChange={(e) => setEpisodes(Number(e.target.value))}>
            {EPISODES.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-seed">
          <span>Max steps</span>
          <input value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} />
        </label>
        <label className="field field-seed">
          <span>Base seed</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <label className="field">
          <span>Actions</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as 'uniform' | 'boundary')}>
            <option value="uniform">Uniform random</option>
            <option value="boundary">Boundary-biased (extremes)</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={job.running}>
          {job.running ? <span className="spinner" /> : '🧨'} Fuzz
        </button>
      </form>

      {job.running && (
        <JobProgressBar progress={job.progress} onCancel={job.cancel}>
          {live?.episodes != null && <TotalsLine totals={live as FuzzTotals} groups={live.groups ?? 0} />}
        </JobProgressBar>
      )}

      {job.error && (
        <div className="alert alert-error">
          <div className="alert-title">Fuzzing failed</div>
          <pre>{job.error.error}</pre>
          <InstallHint message={job.error.error} />
          {job.error.traceback && (
            <details>
              <summary>Traceback</summary>
              <pre>{job.error.traceback}</pre>
            </details>
          )}
        </div>
      )}

      {!report && !job.running && !job.error && (
        <div className="card intro">
          <h3>🧨 Environment fuzzer</h3>
          <p className="muted">
            Runs thousands of seeded episodes with random (or boundary-biased) actions and records every crash, contract violation, NaN/Inf
            and out-of-space observation. Failures are grouped by cause, checked for reproducibility, and{' '}
            <b>shrunk to the shortest action sequence</b> that still triggers them.
          </p>
          <p className="muted">
            Every failure has a <b>▶ Replay failure</b> button that re-runs the exact seed + actions in the Arena and pauses on the failing step.
          </p>
        </div>
      )}

      {report && <FuzzReportView report={report} onReplay={onReplay} />}
    </div>
  );
}

function TotalsLine({ totals, groups }: { totals: FuzzTotals; groups: number }) {
  return (
    <div className="fuzz-totals">
      <span>
        <b>{totals.episodes.toLocaleString()}</b> episodes
      </span>
      <span>
        <b>{totals.steps.toLocaleString()}</b> steps
      </span>
      <span className="t-valid">
        <b>{totals.valid.toLocaleString()}</b> valid
      </span>
      <span className="t-susp">
        <b>{totals.suspicious.toLocaleString()}</b> suspicious
      </span>
      <span className="t-fail">
        <b>{totals.failed.toLocaleString()}</b> failed
      </span>
      {totals.crashed > 0 && (
        <span className="t-fail">
          <b>{totals.crashed.toLocaleString()}</b> crashed
        </span>
      )}
      <span>
        <b>{groups}</b> distinct issue{groups === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function FuzzReportView({ report, onReplay }: { report: FuzzReport; onReplay: (r: ReplayRequest) => void }) {
  const t = report.totals;
  const name = report.envId.includes(':') ? basename(report.envId) : report.envId;
  const pct = (n: number) => (t.episodes ? `${((100 * n) / t.episodes).toFixed(1)}%` : '—');
  return (
    <div className="fuzz-report">
      <div className="card">
        <h3>
          Results · {name}
          <span className="small muted">
            {report.strategy} actions · seeds {report.seed}–{report.seed + t.episodes - 1} · {report.seconds.toFixed(1)}s ·{' '}
            {Math.round(report.stepsPerSecond).toLocaleString()} steps/s
            {report.cancelled && ' · stopped early'}
          </span>
        </h3>
        <div className="fuzz-stack" title="valid / suspicious / failed episodes">
          <div className="seg-valid" style={{ flex: t.valid }} />
          <div className="seg-susp" style={{ flex: t.suspicious }} />
          <div className="seg-fail" style={{ flex: t.failed }} />
        </div>
        <div className="stats">
          <div>
            <span>episodes</span>
            <b>{t.episodes.toLocaleString()}</b>
          </div>
          <div>
            <span>valid</span>
            <b className="t-valid">
              {t.valid.toLocaleString()} <small>{pct(t.valid)}</small>
            </b>
          </div>
          <div>
            <span>suspicious</span>
            <b className="t-susp">
              {t.suspicious.toLocaleString()} <small>{pct(t.suspicious)}</small>
            </b>
          </div>
          <div>
            <span>failed</span>
            <b className="t-fail">
              {t.failed.toLocaleString()} <small>{pct(t.failed)}</small>
            </b>
          </div>
          <div>
            <span>crashes</span>
            <b className={t.crashed ? 't-fail' : ''}>{t.crashed.toLocaleString()}</b>
          </div>
          <div>
            <span>hit step cap</span>
            <b>{t.capped.toLocaleString()}</b>
          </div>
        </div>
        {report.groups.length === 0 && (
          <div className="healthy">
            <span className="ok-dot" /> No crashes, contract violations or invalid observations in {t.episodes.toLocaleString()} episodes.
          </div>
        )}
      </div>

      {report.groups.map((g) => (
        <FailureGroup key={g.signature} group={g} envId={report.envId} total={t.episodes} onReplay={onReplay} />
      ))}
    </div>
  );
}

function FailureGroup({ group: g, envId, total, onReplay }: { group: FuzzGroup; envId: string; total: number; onReplay: (r: ReplayRequest) => void }) {
  const [showEpisodes, setShowEpisodes] = useState(false);
  const minimal = g.minimalActions ?? g.actions;
  const shrunk = minimal.length < g.actions.length;
  const loc = g.exception?.location;
  const replay = (actions: unknown[], label: string, seed = g.seed) =>
    onReplay({ env: envId, seed, actions, stopAt: actions.length || undefined, label, signature: g.signature, kind: 'fuzz' });

  return (
    <div className={`card failure failure-${g.level}`}>
      <div className="failure-head">
        <span className={`tag ${g.level === 'critical' ? 'tag-bad' : 'tag-trunc'}`}>{g.level === 'critical' ? 'FAIL' : 'WARN'}</span>
        <b className="failure-title">{g.message}</b>
        <span className="muted small">
          {g.count.toLocaleString()} / {total.toLocaleString()} episodes
        </span>
      </div>
      <div className="failure-meta small">
        <span>
          first seen: episode {g.episode} · seed <b>{g.seed}</b> · step <b>{g.step}</b>
        </span>
        <span className={g.reproducible ? 'repro-ok' : 'repro-bad'}>
          {g.reproducible ? '✓ reproducible' : '✕ not reproducible (non-deterministic env)'}
        </span>
        {g.step > 0 && (
          <span>
            minimal sequence: <b>{minimal.length}</b> action{minimal.length === 1 ? '' : 's'}
            {shrunk && <span className="muted"> (shrunk from {g.actions.length})</span>}
          </span>
        )}
        {g.step === 0 && <span>happens on reset(): no actions needed</span>}
      </div>
      {minimal.length > 0 && minimal.length <= 40 && (
        <div className="action-seq">
          {minimal.map((a, i) => (
            <code key={i}>{formatAction(a)}</code>
          ))}
        </div>
      )}
      {g.exception && (
        <details className="small">
          <summary>
            <code>
              {g.exception.type}: {g.exception.message}
            </code>
          </summary>
          <pre>{g.exception.traceback}</pre>
        </details>
      )}
      <div className="failure-actions">
        <button className="btn btn-primary btn-small" onClick={() => replay(minimal, `${g.message} · seed ${g.seed}`)}>
          ▶ Replay failure
        </button>
        {shrunk && (
          <button className="btn btn-small" onClick={() => replay(g.actions, `${g.message} · seed ${g.seed} (original)`)}>
            Replay original ({g.actions.length} steps)
          </button>
        )}
        {loc && (
          <button className="btn btn-small" onClick={() => void request('ui:openFile', { file: loc.file, line: loc.line })}>
            📄 {basename(loc.file)}:{loc.line}
          </button>
        )}
        {g.episodes.length > 1 && (
          <button className="link" onClick={() => setShowEpisodes(!showEpisodes)}>
            {showEpisodes ? 'hide' : 'show'} other episodes
          </button>
        )}
      </div>
      {showEpisodes && (
        <div className="episode-refs">
          {g.episodes.map((e) => (
            <span key={e.episode} className="muted small">
              ep {e.episode} · seed {e.seed} · step {e.step}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatAction(a: unknown): string {
  if (a && typeof a === 'object' && 'nd' in (a as Record<string, unknown>)) {
    const flat = (a as { nd: unknown }).nd;
    const s = JSON.stringify(flat, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v));
    return s.length > 40 ? s.slice(0, 37) + '…' : s;
  }
  return String(a);
}
