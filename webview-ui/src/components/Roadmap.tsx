const ITEMS: Record<string, { icon: string; title: string; points: string[] }> = {
  training: {
    icon: '📊',
    title: 'Training Dashboard',
    points: ['Reward, episode length, loss and entropy curves', 'Live metrics from SB3 / TensorBoard logs', 'Regression alerts when performance drops'],
  },
  replay: {
    icon: '🎥',
    title: 'Episode Replay',
    points: ['Record full episodes to disk', 'Scrub any past episode step by step', 'Jump straight to the step where things went wrong'],
  },
  fuzzer: {
    icon: '🧪',
    title: 'Environment Fuzzer',
    points: ['Thousands of random trajectories against reset()/step()', 'Catch NaN observations, invalid actions, broken resets', 'Reproducible failing seeds + action sequences'],
  },
  rewards: {
    icon: '🎯',
    title: 'Reward Detective',
    points: ['Reward distribution and sparsity', 'Positive / negative reward frequency', 'Evidence for reward-shaping issues'],
  },
};

export function Roadmap({ tab }: { tab: keyof typeof ITEMS }) {
  const item = ITEMS[tab];
  return (
    <div className="roadmap">
      <div className="card">
        <div className="roadmap-icon">{item.icon}</div>
        <h2>{item.title}</h2>
        <p className="muted">Coming in a future RLForge release.</p>
        <ul>
          {item.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="muted small">
          The Arena already flags NaN/Inf values, observation-space violations and exploding rewards on every step.
        </p>
      </div>
    </div>
  );
}

export type RoadmapTab = keyof typeof ITEMS;
