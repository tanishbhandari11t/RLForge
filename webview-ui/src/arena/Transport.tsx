import type { SessionStatus } from '../types';

interface Props {
  status: SessionStatus | null;
  disabled: boolean;
  live: boolean;
  cursorStep: number | null;
  lastStep: number;
  onPlay: () => void;
  onPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onReset: () => void;
  onSpeed: (speed: number) => void;
  onAutoReset: (value: boolean) => void;
  onBackToLive: () => void;
}

const MIN = 0.1;
const MAX = 10;
const PRESETS = [0.25, 0.5, 1, 2, 4, 10];

const toSlider = (speed: number) => (Math.log(speed / MIN) / Math.log(MAX / MIN)) * 100;
const fromSlider = (v: number) => {
  const raw = MIN * Math.pow(MAX / MIN, v / 100);
  const snapped = PRESETS.find((p) => Math.abs(p - raw) / p < 0.06);
  return snapped ?? Math.round(raw * 100) / 100;
};

export function Transport(props: Props) {
  const { status, disabled, live } = props;
  const playing = !!status?.playing;
  const speed = status?.speed ?? 1;

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button className="tbtn" title="Previous step (←)" disabled={disabled} onClick={props.onStepBack}>
          ⏮
        </button>
        {playing ? (
          <button className="tbtn tbtn-main" title="Pause (Space)" disabled={disabled} onClick={props.onPause}>
            ⏸
          </button>
        ) : (
          <button className="tbtn tbtn-main" title="Play (Space)" disabled={disabled} onClick={props.onPlay}>
            ▶
          </button>
        )}
        <button className="tbtn" title="Next step (→)" disabled={disabled} onClick={props.onStepForward}>
          ⏭
        </button>
        <button className="tbtn" title="Reset episode (R)" disabled={disabled} onClick={props.onReset}>
          ↻
        </button>
      </div>

      <div className="speed">
        <span className="speed-label">🐢</span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={toSlider(speed)}
          disabled={disabled}
          onChange={(e) => props.onSpeed(fromSlider(Number(e.target.value)))}
          aria-label="Playback speed"
        />
        <span className="speed-label">🐇</span>
        <span className="speed-value">{speed < 1 ? speed.toFixed(2) : speed.toFixed(speed % 1 ? 1 : 0)}x</span>
        <div className="speed-presets">
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`preset ${Math.abs(p - speed) < 1e-6 ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => props.onSpeed(p)}
            >
              {p}x
            </button>
          ))}
        </div>
      </div>

      <div className="transport-right">
        {!live && props.cursorStep !== null ? (
          <button className="btn btn-ghost" onClick={props.onBackToLive} title="Jump back to the latest step">
            ⏪ step {props.cursorStep}/{props.lastStep} · back to live
          </button>
        ) : null}
        <label className="field-check" title="Start a new episode automatically when one ends">
          <input
            type="checkbox"
            checked={status?.autoReset ?? true}
            disabled={disabled}
            onChange={(e) => props.onAutoReset(e.target.checked)}
          />
          Auto-reset
        </label>
      </div>
    </div>
  );
}
