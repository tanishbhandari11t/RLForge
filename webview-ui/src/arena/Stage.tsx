import type { Frame, SessionStatus, TimelineEntry } from '../types';
import { fmt, fmtSigned, toNumber } from '../format';
import { assets } from '../vscode';
import { POPULAR_ENVS } from './SetupBar';

interface Props {
  frame: Frame | null;
  entry: TimelineEntry | undefined;
  status: SessionStatus | null;
  episode: number;
  live: boolean;
  hasSession: boolean;
  loading: boolean;
  renderMode: string | null | undefined;
  onQuickLaunch: (env: string) => void;
}

export function Stage({ frame, entry, status, episode, live, hasSession, loading, renderMode, onQuickLaunch }: Props) {
  if (!hasSession) {
    return (
      <div className="stage stage-empty">
        <div className="hero">
          {assets.mark && <img className="hero-mark" src={assets.mark} alt="RLForge" />}
          <h1>
            <span className="brand-rl">Agent</span> Arena
          </h1>
          <p>Watch your agent play, pause on any decision, and step through state → action → reward → next state.</p>
          {loading ? (
            <div className="hero-loading">
              <span className="spinner" /> Creating environment…
            </div>
          ) : (
            <div className="chips">
              {POPULAR_ENVS.slice(0, 6).map((env) => (
                <button key={env} className="chip" onClick={() => onQuickLaunch(env)}>
                  ▶ {env}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const ended = entry?.terminated || entry?.truncated;
  const reward = entry?.reward;
  const rewardNum = toNumber(reward ?? 0);
  const critical = entry?.anomalies.some((a) => a.level === 'critical');

  return (
    <div className={`stage ${critical ? 'stage-alert' : ''}`}>
      <div className="stage-canvas">
        {frame?.kind === 'image' && (
          <img
            className={`frame ${frame.pixelated ? 'pixelated' : ''}`}
            src={frame.src}
            width={frame.width}
            height={frame.height}
            alt="environment frame"
            draggable={false}
          />
        )}
        {frame?.kind === 'text' && <pre className="frame-text">{frame.text}</pre>}
        {!frame && (
          <div className="frame-none">
            {renderMode ? 'Waiting for first frame…' : 'This environment does not support rgb_array or ansi rendering.'}
            <br />
            <small>Observations, actions and rewards are still shown on the right.</small>
          </div>
        )}
      </div>

      <div className="hud hud-tl">
        <span className="hud-pill">EP {episode}</span>
        <span className="hud-pill">STEP {entry?.step ?? 0}</span>
        {!live && <span className="hud-pill hud-replay">⏪ REVIEWING</span>}
        {live && status?.playing && <span className="hud-pill hud-live">● LIVE {fmt(status.speed, 2)}x</span>}
      </div>
      <div className="hud hud-tr">
        {reward !== undefined && (
          <span className={`hud-pill ${rewardNum > 0 ? 'pos' : rewardNum < 0 ? 'neg' : ''}`}>r {fmtSigned(reward)}</span>
        )}
        <span className="hud-pill hud-return">Σ {fmt(entry?.totalReward ?? 0, 2)}</span>
      </div>
      {critical && (
        <div className="hud hud-bl">
          <span className="hud-pill hud-critical">🚨 {entry!.anomalies.find((a) => a.level === 'critical')!.message}</span>
        </div>
      )}
      {ended && (
        <div className={`banner ${entry!.terminated ? 'banner-term' : 'banner-trunc'}`}>
          {entry!.terminated ? 'TERMINATED' : 'TRUNCATED'}
          <small>
            return {fmt(entry!.totalReward, 2)} · {entry!.step} steps
          </small>
        </div>
      )}
    </div>
  );
}
