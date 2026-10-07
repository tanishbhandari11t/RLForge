import type { EngineState } from '../types';
import { request } from '../vscode';

export function EngineBanner({ engine }: { engine: EngineState }) {
  if (engine.status === 'starting') {
    return (
      <div className="alert alert-info">
        <span className="spinner" /> Starting the RLForge Python engine…
      </div>
    );
  }
  if (engine.status === 'error' || engine.status === 'stopped') {
    return (
      <div className="alert alert-error">
        <div className="alert-title">{engine.status === 'error' ? 'The RLForge engine is not running' : 'Engine stopped'}</div>
        {engine.error && <pre>{engine.error}</pre>}
        <div className="alert-actions">
          <button className="btn btn-primary" onClick={() => void request('ui:restartEngine')}>
            ↻ Start engine
          </button>
          <button className="btn" onClick={() => void request('ui:selectPython')}>
            🐍 Select Python interpreter
          </button>
          <button className="btn btn-ghost" onClick={() => void request('ui:showLog')}>
            Show log
          </button>
        </div>
      </div>
    );
  }
  const packages = engine.hello?.packages ?? {};
  if (!packages.gymnasium) {
    return (
      <div className="alert alert-warn">
        <div className="alert-title">Gymnasium is not installed in {engine.hello?.executable ?? 'the selected interpreter'}</div>
        <p>RLForge drives environments through the Gymnasium API. Install it (classic-control adds rendering via pygame):</p>
        <div className="alert-actions">
          <button className="btn btn-primary" onClick={() => void request('ui:installPackages', { packages: ['gymnasium[classic-control]'] })}>
            📦 pip install gymnasium[classic-control]
          </button>
          <button className="btn" onClick={() => void request('ui:restartEngine')}>
            ↻ Restart engine
          </button>
          <button className="btn btn-ghost" onClick={() => void request('ui:selectPython')}>
            Use a different interpreter
          </button>
        </div>
      </div>
    );
  }
  return null;
}
