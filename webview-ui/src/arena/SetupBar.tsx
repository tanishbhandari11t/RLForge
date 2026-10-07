import type { ProjectInfo } from '../types';
import { basename } from '../format';

export const POPULAR_ENVS = [
  'CartPole-v1',
  'MountainCar-v0',
  'MountainCarContinuous-v0',
  'Acrobot-v1',
  'Pendulum-v1',
  'LunarLander-v3',
  'BipedalWalker-v3',
  'FrozenLake-v1',
  'Taxi-v3',
  'CliffWalking-v1',
  'Blackjack-v1',
];

export interface SetupForm {
  env: string;
  seed: string;
  agentKind: 'random' | 'sb3';
  modelPath: string;
  algorithm: string;
  deterministic: boolean;
}

interface Props {
  form: SetupForm;
  onChange: (patch: Partial<SetupForm>) => void;
  onLaunch: () => void;
  onPickModel: () => void;
  loading: boolean;
  project: ProjectInfo | null;
  registeredEnvs: string[];
  launchedEnv: string | null;
}

const ALGORITHMS = ['auto', 'PPO', 'A2C', 'DQN', 'SAC', 'TD3', 'DDPG'];

export function SetupBar({ form, onChange, onLaunch, onPickModel, loading, project, registeredEnvs, launchedEnv }: Props) {
  const detected = project?.environments ?? [];
  const suggestions = Array.from(
    new Set([...detected.map((e) => e.spec), ...POPULAR_ENVS, ...registeredEnvs]),
  );
  const models = project?.models ?? [];
  const modelValue =
    form.agentKind === 'random' ? 'random' : models.some((m) => m.file === form.modelPath) ? form.modelPath : 'custom';

  return (
    <form
      className="setup"
      onSubmit={(e) => {
        e.preventDefault();
        onLaunch();
      }}
    >
      <label className="field field-env">
        <span>Environment</span>
        <input
          list="rlforge-envs"
          value={form.env}
          placeholder="CartPole-v1 or path/to/env.py:MyEnv"
          spellCheck={false}
          onChange={(e) => onChange({ env: e.target.value })}
        />
        <datalist id="rlforge-envs">
          {suggestions.map((id) => (
            <option key={id} value={id}>
              {detected.find((d) => d.spec === id) ? 'in this project' : undefined}
            </option>
          ))}
        </datalist>
      </label>

      <label className="field field-agent">
        <span>Agent</span>
        <select
          value={modelValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'random') onChange({ agentKind: 'random' });
            else if (v === 'browse') onPickModel();
            else if (v !== 'custom') onChange({ agentKind: 'sb3', modelPath: v });
          }}
        >
          <option value="random">🎲 Random agent</option>
          {models.length > 0 && (
            <optgroup label="Trained models in this project">
              {models.map((m) => (
                <option key={m.file} value={m.file}>
                  🧠 {m.label}
                  {m.algorithm ? ` (${m.algorithm})` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {modelValue === 'custom' && <option value="custom">🧠 {basename(form.modelPath)}</option>}
          <option value="browse">📂 Load SB3 model (.zip)…</option>
        </select>
      </label>

      {form.agentKind === 'sb3' && (
        <>
          <label className="field field-small">
            <span>Algorithm</span>
            <select value={form.algorithm} onChange={(e) => onChange({ algorithm: e.target.value })}>
              {ALGORITHMS.map((a) => (
                <option key={a} value={a}>
                  {a === 'auto' ? 'Auto-detect' : a}
                </option>
              ))}
            </select>
          </label>
          <label className="field-check" title="Use the most likely action instead of sampling from the policy">
            <input
              type="checkbox"
              checked={form.deterministic}
              onChange={(e) => onChange({ deterministic: e.target.checked })}
            />
            Deterministic
          </label>
        </>
      )}

      <label className="field field-seed">
        <span>Seed</span>
        <input
          value={form.seed}
          inputMode="numeric"
          placeholder="none"
          onChange={(e) => onChange({ seed: e.target.value.replace(/[^\d-]/g, '') })}
        />
      </label>

      <button type="submit" className="btn btn-primary btn-launch" disabled={loading || !form.env.trim()}>
        {loading ? <span className="spinner" /> : '🚀'}
        {loading ? 'Launching…' : launchedEnv ? 'Relaunch' : 'Launch'}
      </button>
    </form>
  );
}
