import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineError, Frame, PanelCommand, ProjectInfo, Settings } from '../types';
import { basename, flatten, toNumber } from '../format';
import { persist, persisted, request } from '../vscode';
import { EpisodeHistory, HealthPanel } from './EpisodeHistory';
import { SetupBar, SetupForm } from './SetupBar';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { TransitionPanel } from './TransitionPanel';
import { Transport } from './Transport';
import type { ArenaController } from './useArena';
import { InstallHint } from '../components/InstallHint';

interface Props {
  arena: ArenaController;
  project: ProjectInfo | null;
  settings: Settings;
  command: { seq: number; command: PanelCommand } | null;
  registeredEnvs: string[];
  active: boolean;
}

export function ArenaView({ arena, project, settings, command, registeredEnvs, active }: Props) {
  const { state: s, actions } = arena;
  const [form, setForm] = useState<SetupForm>(() => ({
    env: 'CartPole-v1',
    seed: String(settings.defaultSeed),
    agentKind: 'random',
    modelPath: '',
    algorithm: 'auto',
    deterministic: true,
    ...persisted<{ form: SetupForm }>().form,
  }));
  const formRef = useRef(form);
  formRef.current = form;
  const update = (patch: Partial<SetupForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => persist({ form }), [form]);

  const launch = (override?: Partial<SetupForm>) => {
    const f = { ...formRef.current, ...override };
    if (override) setForm(f);
    const seed = f.seed.trim() === '' ? null : Number(f.seed);
    void actions.launch({
      env: f.env.trim(),
      seed: Number.isFinite(seed) ? seed : null,
      autoReset: s.replay ? settings.autoReset : s.status?.autoReset ?? settings.autoReset,
      record: !s.replay && !!s.status?.recording,
      agent:
        f.agentKind === 'sb3'
          ? {
              kind: 'sb3',
              path: f.modelPath,
              algorithm: f.algorithm === 'auto' ? undefined : f.algorithm,
              deterministic: f.deterministic,
            }
          : { kind: 'random' },
    });
  };

  const pickModel = async () => {
    const path = await request<string | null>('ui:pickModel');
    if (path) update({ agentKind: 'sb3', modelPath: path });
  };

  useEffect(() => {
    if (!command) return;
    const c = command.command;
    if (c.replay) {
      void actions.launchReplay(c.replay);
      return;
    }
    const patch: Partial<SetupForm> = {};
    if (c.env) patch.env = c.env;
    if (c.model) Object.assign(patch, { agentKind: 'sb3', modelPath: c.model });
    if (c.autoLaunch) launch(patch);
    else if (Object.keys(patch).length) update(patch);
  }, [command?.seq]);

  const timeline = s.timeline;
  const lastIndex = timeline.length - 1;
  const index = s.cursor ?? lastIndex;
  const entry = timeline[index];
  const previous = index > 0 ? timeline[index - 1] : undefined;
  const live = s.cursor === null;

  const frame: Frame | null = useMemo(() => {
    for (let i = index; i >= 0 && i > index - 400; i--) {
      const f = timeline[i]?.frame;
      if (f) return f;
    }
    return null;
  }, [timeline, index, timeline.length, timeline[index]?.frame]);

  const scaleRef = useRef<number[]>([]);
  const lastScaled = useRef(0);
  if (s.sessionId !== lastScaled.current) {
    scaleRef.current = [];
    lastScaled.current = s.sessionId;
  }
  const latest = timeline[lastIndex];
  if (latest) {
    flatten(latest.obs)?.forEach((r) => {
      const v = Math.abs(toNumber(r.value));
      if (Number.isFinite(v)) scaleRef.current[r.index] = Math.max(scaleRef.current[r.index] ?? 1e-6, v);
    });
  }

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) && (target as HTMLInputElement).type !== 'range') return;
      if (!s.inspection) return;
      if (e.key === ' ') {
        e.preventDefault();
        void actions.togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        void actions.stepForward();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void actions.stepBack();
      } else if (e.key === 'r' || e.key === 'R') {
        void actions.reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const hasSession = !!s.inspection && timeline.length > 0;

  return (
    <div className="arena">
      <SetupBar
        form={form}
        onChange={update}
        onLaunch={() => launch()}
        onPickModel={pickModel}
        loading={s.loading}
        project={project}
        registeredEnvs={registeredEnvs}
        launchedEnv={s.envId}
      />

      {s.loadError && (
        <div className="alert alert-error">
          <div className="alert-title">Launch failed</div>
          <pre>{s.loadError.message}</pre>
          <InstallHint message={s.loadError.message} />
          <div className="alert-actions">
            {s.loadError.traceback && (
              <details>
                <summary>Traceback</summary>
                <pre>{s.loadError.traceback}</pre>
              </details>
            )}
            <button className="btn btn-ghost" onClick={actions.clearLoadError}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {s.replay && (
        <div className="alert alert-info replay-banner">
          <div>
            <div className="alert-title">🎥 Replaying · {s.replay.label}</div>
            <div className="small muted">
              seed {s.replay.seed ?? '—'} · {s.replay.steps} recorded action{s.replay.steps === 1 ? '' : 's'}
              {s.replay.stopAt != null && <> · pauses at step {s.replay.stopAt}</>}
              {' · '}deterministic re-simulation, so every frame, observation and reward is recomputed
            </div>
            {s.replayEnded && (
              <div className={`small ${s.replayEnded.diverged ? 'bad' : ''}`}>
                {s.replayEnded.diverged
                  ? '⚠ Replay finished, but the trajectory diverged from the recording (the environment is not deterministic).'
                  : `✓ Replay finished after ${s.replayEnded.step} steps. Press ▶ to watch it again or drag the timeline.`}
              </div>
            )}
          </div>
          <button className="btn" onClick={() => launch()}>
            Exit replay
          </button>
        </div>
      )}

      {s.error && <ErrorCard error={s.error} onDismiss={actions.dismissError} />}

      {s.warnings.length > 0 && (
        <div className="alert alert-warn">
          {s.warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
          <button className="btn btn-ghost" onClick={actions.dismissWarnings}>
            Dismiss
          </button>
        </div>
      )}

      <div className="arena-body">
        <div className="arena-main">
          {hasSession && (
            <div className="session-line">
              <b>{s.inspection!.envId.includes(':') ? basename(s.inspection!.envId) : s.inspection!.envId}</b>
              <span className="muted">
                {s.inspection!.observationSpace.repr.length < 60 ? s.inspection!.observationSpace.repr : s.inspection!.observationSpace.type}
                {' → '}
                {s.inspection!.actionSpace.repr.length < 60 ? s.inspection!.actionSpace.repr : s.inspection!.actionSpace.type}
              </span>
              <span className="muted">seed {s.seed ?? '—'}</span>
              <span className="muted">shortcuts: Space · ← → · R</span>
              {!s.replay && (
                <span className="session-actions">
                  <button
                    className={`btn btn-small ${s.status?.recording ? 'btn-recording' : ''}`}
                    title="Save every finished episode to .rlforge/episodes so you can replay it later"
                    onClick={() => void actions.setRecording(!s.status?.recording)}
                  >
                    {s.status?.recording ? '⏺ Recording' : '⏺ Record'}
                  </button>
                  <button className="btn btn-small" title="Save the current episode now" onClick={() => void actions.saveEpisode()}>
                    💾 Save episode
                  </button>
                  {s.lastSaved && Date.now() - s.lastSaved.at < 4000 && <span className="small saved-note">saved ✓</span>}
                </span>
              )}
            </div>
          )}
          <Stage
            frame={frame}
            entry={entry}
            status={s.status}
            episode={s.episode}
            live={live}
            hasSession={hasSession}
            loading={s.loading}
            renderMode={s.inspection?.renderMode}
            onQuickLaunch={(env) => launch({ env })}
          />
          <Transport
            status={s.status}
            disabled={!hasSession}
            live={live}
            cursorStep={entry && !live ? entry.step : null}
            lastStep={timeline[lastIndex]?.step ?? 0}
            onPlay={actions.play}
            onPause={actions.pause}
            onStepBack={actions.stepBack}
            onStepForward={actions.stepForward}
            onReset={actions.reset}
            onSpeed={actions.setSpeed}
            onAutoReset={actions.setAutoReset}
            onBackToLive={() => actions.seek(null)}
          />
          {hasSession && (
            <Timeline
              timeline={timeline}
              length={timeline.length}
              cursor={s.cursor}
              onSeek={actions.seek}
              marker={s.replay?.stopAt ?? null}
            />
          )}
          {hasSession && (
            <div className="arena-bottom">
              <EpisodeHistory history={s.history} rewardThreshold={s.inspection?.spec?.rewardThreshold ?? null} />
              <HealthPanel anomalies={s.anomalies} />
            </div>
          )}
        </div>
        <TransitionPanel
          entry={hasSession ? entry : undefined}
          previous={previous}
          inspection={s.inspection}
          agent={s.agent}
          scale={scaleRef.current}
          onDeterministic={actions.setDeterministic}
        />
      </div>
    </div>
  );
}

function ErrorCard({ error, onDismiss }: { error: EngineError; onDismiss: () => void }) {
  const loc = error.location;
  return (
    <div className="alert alert-error">
      <div className="alert-title">
        🚨 {error.where === 'agent' ? 'The agent raised an exception' : `env.${error.where}() raised an exception`}
      </div>
      <pre>{error.message}</pre>
      <div className="alert-actions">
        {loc && (
          <button className="btn btn-primary" onClick={() => void request('ui:openFile', { file: loc.file, line: loc.line })}>
            Open {basename(loc.file)}:{loc.line}
          </button>
        )}
        <details>
          <summary>Traceback</summary>
          <pre>{error.traceback}</pre>
        </details>
        <button className="btn btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
