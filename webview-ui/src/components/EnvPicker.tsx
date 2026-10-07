import type { ProjectInfo } from '../types';
import { POPULAR_ENVS } from '../arena/SetupBar';

interface Props {
  id: string;
  value: string;
  onChange: (env: string) => void;
  project: ProjectInfo | null;
  registeredEnvs: string[];
}

/** Environment field with suggestions: project envs first (custom ones on top), then popular and registered ids. */
export function EnvPicker({ id, value, onChange, project, registeredEnvs }: Props) {
  const detected = [...(project?.environments ?? [])].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'custom' ? -1 : 1));
  const suggestions = Array.from(new Set([...detected.map((e) => e.spec), ...POPULAR_ENVS, ...registeredEnvs]));
  return (
    <label className="field field-env">
      <span>Environment</span>
      <input
        list={id}
        value={value}
        spellCheck={false}
        placeholder="CartPole-v1 or path/to/env.py:MyEnv"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  );
}
