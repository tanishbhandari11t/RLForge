const ITEMS: Record<string, { icon: string; title: string; points: string[] }> = {
  training: {
    icon: '📊',
    title: 'Training Debugger',
    points: [
      'Reward, episode length, loss and entropy curves from SB3 / TensorBoard logs',
      'Policy collapse, value-loss explosions and entropy crashes, explained',
      'Jump from a bad training step to a replay of the episode behind it',
    ],
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
          Available today: Arena, Inspector, Health check, Fuzzer, Episode replay and Reward detective.
        </p>
      </div>
    </div>
  );
}

export type RoadmapTab = keyof typeof ITEMS;
