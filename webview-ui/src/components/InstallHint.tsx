import { request } from '../vscode';

/** Turns "pip install ..." advice inside an error message into a one-click install button. */
export function InstallHint({ message }: { message: string }) {
  const packages = suggestPackages(message);
  if (!packages) return null;
  return (
    <div className="install-hint">
      <button className="btn btn-primary" onClick={() => void request('ui:installPackages', { packages })}>
        📦 pip install {packages.join(' ')}
      </button>
      <button className="btn btn-ghost" onClick={() => void request('ui:restartEngine')}>
        Restart engine after installing
      </button>
    </div>
  );
}

export function suggestPackages(message: string): string[] | null {
  const m = message.match(/pip install\s+([^`'\n]+?)(?:[`'\n]|$|\s+(?:and|or|to|then)\b)/i);
  if (m) {
    const pkgs = m[1]
      .split(/\s+/)
      .map((p) => p.replace(/^["']|["'.,]$/g, ''))
      .filter((p) => p && !p.startsWith('-'));
    if (pkgs.length) return pkgs;
  }
  if (/No module named ['"]?gymnasium/i.test(message) || /gymnasium is not installed/i.test(message)) {
    return ['gymnasium[classic-control]'];
  }
  if (/No module named ['"]?pygame/i.test(message)) return ['pygame'];
  if (/No module named ['"]?Box2D/i.test(message)) return ['swig', 'gymnasium[box2d]'];
  if (/No module named ['"]?stable_baselines3/i.test(message)) return ['stable-baselines3'];
  return null;
}
