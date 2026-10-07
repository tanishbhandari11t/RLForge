import { useEffect, useState } from 'react';
import type { FuzzReport, PanelCommand, ProjectInfo, RewardProfile } from '../types';
import { basename } from '../format';
import { useJob } from '../jobs/useJob';
import { EnvPicker } from '../components/EnvPicker';
import { JobProgressBar } from '../components/JobProgressBar';
import { RewardProfileView } from '../components/RewardProfileView';

export interface ProfileEntry {
  envId: string;
  source: string;
  profile: RewardProfile;
}

interface Props {
  project: ProjectInfo | null;
  registeredEnvs: string[];
  command: { seq: number; command: PanelCommand } | null;
  defaultEnv: string | null;
  latest: ProfileEntry | null;
  onProfile: (envId: string, source: string, profile: RewardProfile) => void;
}

export function RewardsView({ project, registeredEnvs, command, defaultEnv, latest, onProfile }: Props) {
  const [env, setEnv] = useState(defaultEnv ?? 'CartPole-v1');
  const job = useJob<FuzzReport>((r) => onProfile(r.envId, `${r.totals.episodes} random episodes`, r.rewardProfile));

  const run = (target = env) => {
    if (!target.trim()) return;
    setEnv(target);
    void job.start('start_fuzz', { env: target.trim(), episodes: 300, maxSteps: 1000, seed: 0, strategy: 'uniform', timeBudget: 60 });
  };

  useEffect(() => {
    const c = command?.command;
    if (c?.tab !== 'rewards') return;
    if (c.env) setEnv(c.env);
    if (c.run && c.env) run(c.env);
  }, [command?.seq]);

  return (
    <div className="tool-view">
      <form
        className="setup"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <EnvPicker id="rlforge-reward-envs" value={env} onChange={setEnv} project={project} registeredEnvs={registeredEnvs} />
        <button className="btn btn-primary" type="submit" disabled={job.running}>
          {job.running ? <span className="spinner" /> : '🎯'} Profile rewards
        </button>
      </form>

      {job.running && <JobProgressBar progress={job.progress} onCancel={job.cancel} />}
      {job.error && (
        <div className="alert alert-error">
          <pre>{job.error.error}</pre>
        </div>
      )}

      {latest ? (
        <div className="card">
          <h3>
            🎯 Reward detective · {latest.envId.includes(':') ? basename(latest.envId) : latest.envId}
            <span className="small muted">from {latest.source}</span>
          </h3>
          <RewardProfileView profile={latest.profile} />
        </div>
      ) : (
        !job.running && (
          <div className="card intro">
            <h3>🎯 Reward detective</h3>
            <p className="muted">
              Profiles your reward function under a random policy: distribution, sparsity, sign balance, distinct values and episode returns,
              with plain-language warnings (sparse rewards, constant rewards, huge magnitudes, NaN rewards). Health checks and fuzz runs update
              this view automatically.
            </p>
          </div>
        )
      )}
    </div>
  );
}
