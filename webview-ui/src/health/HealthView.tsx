import { useEffect, useState } from 'react';
import type { HealthCheck, HealthReport, PanelCommand, ProjectInfo, ReplayRequest, RewardProfile, Settings } from '../types';
import { basename } from '../format';
import { request } from '../vscode';
import { useJob } from '../jobs/useJob';
import { EnvPicker } from '../components/EnvPicker';
import { JobProgressBar } from '../components/JobProgressBar';
import { RewardProfileView } from '../components/RewardProfileView';
import { InstallHint } from '../components/InstallHint';

interface Props {
  project: ProjectInfo | null;
  registeredEnvs: string[];
  settings: Settings;
  command: { seq: number; command: PanelCommand } | null;
  defaultEnv: string | null;
  onReplay: (replay: ReplayRequest) => void;
  onNavigate: (command: PanelCommand) => void;
  onProfile: (envId: string, source: string, profile: RewardProfile) => void;
}

const BUDGETS = [
  { steps: 2000, label: 'Quick · 2k steps' },
  { steps: 5000, label: 'Standard · 5k steps' },
  { steps: 20000, label: 'Thorough · 20k steps' },
];

const ICON: Record<HealthCheck['status'], string> = { pass: '✓', warn: '!', fail: '✕', info: 'i', skip: '–' };

export function HealthView({ project, registeredEnvs, settings, command, defaultEnv, onReplay, onNavigate, onProfile }: Props) {
  const [env, setEnv] = useState(defaultEnv ?? 'CartPole-v1');
  const [budget, setBudget] = useState(5000);
  const [seed, setSeed] = useState(String(settings.defaultSeed));
  const job = useJob<HealthReport>((r) => r.rewardProfile && onProfile(r.envId, 'health check', r.rewardProfile));

  const run = (target = env) => {
    if (!target.trim()) return;
    setEnv(target);
    void job.start('start_health', { env: target.trim(), seed: Number(seed) || 0, stepBudget: budget, timeBudget: 60 });
  };

  useEffect(() => {
    const c = command?.command;
    if (c?.tab !== 'health') return;
    if (c.env) setEnv(c.env);
    if (c.run && c.env) run(c.env);
  }, [command?.seq]);

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
        <EnvPicker id="rlforge-health-envs" value={env} onChange={setEnv} project={project} registeredEnvs={registeredEnvs} />
        <label className="field">
          <span>Budget</span>
          <select value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
            {BUDGETS.map((b) => (
              <option key={b.steps} value={b.steps}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-seed">
          <span>Seed</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={job.running}>
          {job.running ? <span className="spinner" /> : '🩺'} Test environment
        </button>
      </form>

      {job.running && <JobProgressBar progress={job.progress} onCancel={job.cancel} />}

      {job.error && (
        <div className="alert alert-error">
          <div className="alert-title">Health check failed</div>
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
          <h3>🩺 Environment health check</h3>
          <p className="muted">
            One click runs Gymnasium's <code>check_env</code> and then checks things it doesn't: the reset/step contract, seeding, determinism
            (same seed + same actions → same trajectory), crashes, NaN/Inf, observations outside the declared space, exploding values,
            termination, reward signal, rendering and throughput.
          </p>
          <p className="muted">
            Every failure comes with the <b>seed and action sequence</b> that triggers it, so you can replay it step by step in the Arena.
          </p>
          {project?.environments.some((e) => e.kind === 'custom') && (
            <div className="chips">
              {project.environments
                .filter((e) => e.kind === 'custom')
                .map((e) => (
                  <button key={e.spec} className="chip" onClick={() => run(e.spec)}>
                    🩺 {e.label}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {report && <HealthReportView report={report} onReplay={onReplay} onNavigate={onNavigate} />}
    </div>
  );
}

function verdict(score: number) {
  if (score >= 85) return { text: 'Healthy', cls: 'good' };
  if (score >= 60) return { text: 'Needs attention', cls: 'warn' };
  return { text: 'Broken', cls: 'bad' };
}

function HealthReportView({
  report,
  onReplay,
  onNavigate,
}: {
  report: HealthReport;
  onReplay: (r: ReplayRequest) => void;
  onNavigate: (c: PanelCommand) => void;
}) {
  const v = verdict(report.score);
  const counts = { pass: 0, warn: 0, fail: 0 } as Record<string, number>;
  report.checks.forEach((c) => (counts[c.status] = (counts[c.status] ?? 0) + 1));
  const name = report.inspection?.spec?.id ?? (report.envId.includes(':') ? basename(report.envId) : report.envId);
  const ordered = [...report.checks].sort((a, b) => order(a.status) - order(b.status));

  return (
    <div className="health-report">
      <div className="card health-summary">
        <ScoreRing score={report.score} cls={v.cls} />
        <div className="health-summary-body">
          <h2>
            {name} <span className={`verdict verdict-${v.cls}`}>{v.text}</span>
          </h2>
          <div className="muted small">
            {counts.pass} passed · {counts.warn ?? 0} warnings · {counts.fail ?? 0} failed
            {report.stats && (
              <>
                {' '}
                · {report.stats.episodes} episodes / {report.stats.steps.toLocaleString()} steps in {report.stats.seconds.toFixed(1)}s
                {report.stats.cancelled && ' (stopped early)'}
              </>
            )}
          </div>
          <div className="health-actions">
            <button className="btn" onClick={() => onNavigate({ tab: 'arena', env: report.envId, autoLaunch: true })}>
              ▶ Watch in Arena
            </button>
            <button className="btn" onClick={() => onNavigate({ tab: 'fuzzer', env: report.envId, run: true })}>
              🧨 Fuzz 1,000 episodes
            </button>
            {report.inspection?.sourceFile && (
              <button
                className="btn btn-ghost"
                onClick={() => void request('ui:openFile', { file: report.inspection!.sourceFile, line: report.inspection!.sourceLine ?? 1 })}
              >
                📄 Open source
              </button>
            )}
          </div>
        </div>
        {report.frame?.kind === 'image' && <img className="health-frame" src={report.frame.src} alt="" />}
      </div>

      <div className="card">
        <h3>Checklist</h3>
        <div className="checklist">
          {ordered.map((c) => (
            <CheckRow key={c.id} check={c} envId={report.envId} onReplay={onReplay} />
          ))}
        </div>
      </div>

      {report.rewardProfile && report.rewardProfile.steps > 0 && (
        <div className="card">
          <h3>🎯 Reward profile <span className="small muted">random policy</span></h3>
          <RewardProfileView profile={report.rewardProfile} />
        </div>
      )}
    </div>
  );
}

function order(s: HealthCheck['status']) {
  return { fail: 0, warn: 1, pass: 2, info: 3, skip: 4 }[s];
}

function ScoreRing({ score, cls }: { score: number; cls: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`score-ring score-${cls}`} viewBox="0 0 64 64" width={76} height={76}>
      <circle cx={32} cy={32} r={r} className="ring-bg" />
      <circle cx={32} cy={32} r={r} className="ring-fg" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 32 32)" />
      <text x={32} y={37} textAnchor="middle">
        {score}
      </text>
    </svg>
  );
}

function CheckRow({ check, envId, onReplay }: { check: HealthCheck; envId: string; onReplay: (r: ReplayRequest) => void }) {
  const expandable = !!(check.evidence || check.exception || check.messages?.length);
  const [open, setOpen] = useState(check.status === 'fail' && expandable);
  const ev = check.evidence;
  const loc = check.exception?.location;
  return (
    <div className={`check check-${check.status}`}>
      <div className="check-head" onClick={() => expandable && setOpen(!open)} style={{ cursor: expandable ? 'pointer' : 'default' }}>
        <span className={`check-icon icon-${check.status}`}>{ICON[check.status]}</span>
        <div className="check-text">
          <div className="check-title">
            {check.title}
            {check.count != null && check.count > 1 && <span className="muted small"> · {check.count} episodes</span>}
          </div>
          <div className="check-detail">{check.detail}</div>
        </div>
        {expandable && <span className="muted">{open ? '▾' : '▸'}</span>}
      </div>
      {open && (
        <div className="check-body">
          {check.messages?.map((m, i) => (
            <div key={i} className="issue warning">
              {m}
            </div>
          ))}
          {ev && (
            <div className="evidence">
              <span className="muted small">
                Reproduce: seed <b>{ev.seed}</b> · {ev.actions.length} action{ev.actions.length === 1 ? '' : 's'} · fails at step <b>{ev.step}</b>
              </span>
              <button
                className="btn btn-primary btn-small"
                onClick={() =>
                  onReplay({
                    env: envId,
                    seed: ev.seed,
                    actions: ev.actions,
                    stopAt: ev.step || undefined,
                    label: `${check.title} · seed ${ev.seed}`,
                    signature: ev.signature,
                    kind: 'health',
                  })
                }
              >
                ▶ Replay in Arena
              </button>
            </div>
          )}
          {check.exception && (
            <div className="evidence">
              <code className="small">
                {check.exception.type}: {check.exception.message}
              </code>
              {loc && (
                <button className="btn btn-small" onClick={() => void request('ui:openFile', { file: loc.file, line: loc.line })}>
                  📄 {basename(loc.file)}:{loc.line}
                </button>
              )}
              <details>
                <summary>Traceback</summary>
                <pre>{check.exception.traceback}</pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
