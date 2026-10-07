import { useEffect, useState } from 'react';
import type { RecordingMeta, ReplayRequest } from '../types';
import { basename, fmt } from '../format';
import { request } from '../vscode';

interface Props {
  active: boolean;
  /** Changes whenever the Arena saves an episode, so the list refreshes. */
  refreshKey: number;
  onReplay: (replay: ReplayRequest) => void;
  onOpenArena: () => void;
}

export function ReplayView({ active, refreshKey, onReplay, onOpenArena }: Props) {
  const [data, setData] = useState<{ directory: string; recordings: RecordingMeta[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = () =>
    request<{ directory: string; recordings: RecordingMeta[] }>('list_recordings')
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    if (active) void load();
  }, [active, refreshKey]);

  const remove = async (path: string) => {
    await request('delete_recording', { path }).catch((e: Error) => setError(e.message));
    void load();
  };

  const list = (data?.recordings ?? []).filter((r) => !filter || r.envId.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="tool-view">
      <div className="setup">
        <label className="field field-env">
          <span>Filter by environment</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. CartPole" />
        </label>
        <button className="btn" onClick={() => void load()}>
          ⟳ Refresh
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <pre>{error}</pre>
        </div>
      )}

      {data && data.recordings.length === 0 && (
        <div className="card intro">
          <h3>🎥 Episode replay</h3>
          <p className="muted">
            No recorded episodes yet. In the Arena, turn on <b>⏺ Record</b> to save every finished episode, or press <b>💾 Save episode</b> to
            keep the current one. Recordings are stored as JSON Lines in <code>{data.directory}</code>.
          </p>
          <p className="muted">
            A replay re-simulates the environment from the recorded seed and actions, so you get the full frames, observations and the
            agent's recorded decision (action probabilities, value) at every step. If the environment is not deterministic, RLForge flags the
            exact step where the replay diverges from the recording.
          </p>
          <button className="btn btn-primary" onClick={onOpenArena}>
            🎮 Open Arena
          </button>
        </div>
      )}

      {list.length > 0 && (
        <div className="card">
          <h3>
            Recorded episodes <span className="small muted">{data!.directory}</span>
          </h3>
          <table className="recordings">
            <thead>
              <tr>
                <th>Environment</th>
                <th>Agent</th>
                <th>Episode</th>
                <th>Return</th>
                <th>Steps</th>
                <th>Outcome</th>
                <th>Anomalies</th>
                <th>Recorded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.path}>
                  <td title={r.envId}>
                    <b>{r.envId.includes(':') ? basename(r.envId) : r.envId}</b>
                  </td>
                  <td>{r.agent?.name ?? '—'}</td>
                  <td>
                    #{r.episode} <span className="muted small">seed {r.seed ?? '—'}</span>
                  </td>
                  <td>{fmt(r.return, 3)}</td>
                  <td>{r.length}</td>
                  <td>
                    {!r.complete ? (
                      <span className="tag">partial</span>
                    ) : r.terminated ? (
                      <span className="tag tag-term">terminated</span>
                    ) : r.truncated ? (
                      <span className="tag tag-trunc">truncated</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={r.anomalies ? 'bad' : 'muted'}>{r.anomalies || '0'}</td>
                  <td className="muted small">{new Date(r.createdAt * 1000).toLocaleString()}</td>
                  <td className="row-actions">
                    <button className="btn btn-primary btn-small" onClick={() => onReplay({ path: r.path })}>
                      ▶ Replay
                    </button>
                    <button className="btn btn-ghost btn-small" title="Delete recording" onClick={() => void remove(r.path)}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
