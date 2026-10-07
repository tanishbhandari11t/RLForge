import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface SourceRef {
  file: string;
  line: number;
}

export interface DetectedEnv extends SourceRef {
  /** Value passed to the engine: a registered id or `path/to/file.py:ClassName`. */
  spec: string;
  label: string;
  kind: 'registered' | 'custom';
}

export interface DetectedAlgorithm extends SourceRef {
  name: string;
}

export interface DetectedModel {
  file: string;
  label: string;
  algorithm?: string;
}

export interface ProjectInfo {
  scannedAt: number;
  frameworks: string[];
  environments: DetectedEnv[];
  algorithms: DetectedAlgorithm[];
  trainingScripts: SourceRef[];
  models: DetectedModel[];
  pythonFiles: number;
}

export const EXCLUDE_GLOB =
  '**/{node_modules,.venv,venv,env,.env,.git,site-packages,__pycache__,.tox,.mypy_cache,.pytest_cache,dist,build,out,wandb,mlruns}/**';

const MAKE_RE =
  /\b(?:gym|gymnasium)\.make(?:_vec)?\(\s*(?:id\s*=\s*)?["']([^"']+)["']|\bmake_(?:vec|atari)_env\(\s*(?:env_id\s*=\s*)?["']([^"']+)["']/g;
const CLASS_RE = /^[ \t]*class[ \t]+(\w+)[ \t]*\(([^)]*)\)[ \t]*:/gm;
const ENV_BASE_RE = /(^|[\s,(.])(?:gym(?:nasium)?\.)?(?:core\.)?Env\s*(?:\[[^\]]*\])?\s*(?=,|$)/;
const ALGO_RE = /\b(PPO|A2C|DQN|SAC|TD3|DDPG|RecurrentPPO|MaskablePPO|QRDQN|TRPO|TQC|ARS)\s*(?:\(|\.load\s*\()/g;
const FRAMEWORKS: [RegExp, string][] = [
  [/^\s*(?:import|from)\s+gymnasium\b/m, 'Gymnasium'],
  [/^\s*(?:import|from)\s+gym\b(?!nasium)/m, 'Gym (legacy)'],
  [/^\s*(?:import|from)\s+stable_baselines3\b/m, 'Stable-Baselines3'],
  [/^\s*(?:import|from)\s+sb3_contrib\b/m, 'SB3-Contrib'],
  [/^\s*(?:import|from)\s+ray\.rllib\b|^\s*from\s+ray\s+import\s+rllib/m, 'RLlib'],
  [/^\s*(?:import|from)\s+pettingzoo\b/m, 'PettingZoo'],
  [/^\s*(?:import|from)\s+torch\b/m, 'PyTorch'],
  [/^\s*(?:import|from)\s+(?:tensorflow|keras)\b/m, 'TensorFlow'],
  [/^\s*(?:import|from)\s+(?:jax|flax)\b/m, 'JAX'],
];

function lineOf(text: string, index: number): number {
  let line = 0;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

function isSb3Zip(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    const length = Math.min(stat.size, 65536);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, stat.size - length);
      return buf.includes('policy.pth') && buf.includes('data');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function guessAlgorithm(file: string): string | undefined {
  const name = path.basename(file).toLowerCase();
  return ['ppo', 'a2c', 'dqn', 'sac', 'td3', 'ddpg'].find((a) => name.includes(a))?.toUpperCase();
}

/** Spec string for a custom env class, relative to the engine's working directory when possible. */
export function customEnvSpec(file: string, className: string): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const rel = root && file.startsWith(root) ? path.relative(root, file).split(path.sep).join('/') : file;
  return `${rel}:${className}`;
}

export function displayPath(file: string): string {
  return vscode.workspace.asRelativePath(file, false);
}

interface ClassDef extends SourceRef {
  name: string;
  bases: string[];
}

export function findEnvClasses(text: string, file: string, knownEnvNames: Set<string>): ClassDef[] {
  const classes: ClassDef[] = [];
  for (const m of text.matchAll(CLASS_RE)) {
    const bases = m[2].split(',').map((b) => b.trim()).filter(Boolean);
    classes.push({ name: m[1], bases, file, line: lineOf(text, m.index ?? 0) });
  }
  return classes.filter(
    (c) =>
      c.bases.some((b) => ENV_BASE_RE.test(b) && !/Wrapper/.test(b)) ||
      c.bases.some((b) => knownEnvNames.has(b.split('.').pop() ?? b)),
  );
}

export function findMakeCalls(text: string): { id: string; index: number }[] {
  const out: { id: string; index: number }[] = [];
  for (const m of text.matchAll(MAKE_RE)) {
    out.push({ id: m[1] ?? m[2], index: m.index ?? 0 });
  }
  return out;
}

export async function scanProject(): Promise<ProjectInfo> {
  const info: ProjectInfo = {
    scannedAt: Date.now(),
    frameworks: [],
    environments: [],
    algorithms: [],
    trainingScripts: [],
    models: [],
    pythonFiles: 0,
  };
  if (!vscode.workspace.workspaceFolders?.length) {
    return info;
  }

  const files = await vscode.workspace.findFiles('**/*.py', EXCLUDE_GLOB, 3000);
  info.pythonFiles = files.length;
  const frameworks = new Set<string>();
  const seenIds = new Map<string, DetectedEnv>();
  const texts: { file: string; text: string }[] = [];

  for (const uri of files) {
    let text: string;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > 1_000_000) {
        continue;
      }
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      continue;
    }
    const file = uri.fsPath;
    texts.push({ file, text });

    for (const [re, name] of FRAMEWORKS) {
      if (re.test(text)) {
        frameworks.add(name);
      }
    }
    for (const call of findMakeCalls(text)) {
      if (!seenIds.has(call.id)) {
        seenIds.set(call.id, {
          spec: call.id,
          label: call.id,
          kind: 'registered',
          file,
          line: lineOf(text, call.index),
        });
      }
    }
    for (const m of text.matchAll(ALGO_RE)) {
      if (!info.algorithms.some((a) => a.name === m[1])) {
        info.algorithms.push({ name: m[1], file, line: lineOf(text, m.index ?? 0) });
      }
    }
    const base = path.basename(file).toLowerCase();
    const learnIdx = text.search(/\.learn\s*\(|\btrain(?:er)?\s*\(/);
    if (learnIdx >= 0 || /train/.test(base)) {
      info.trainingScripts.push({ file, line: learnIdx >= 0 ? lineOf(text, learnIdx) : 0 });
    }
  }

  const envNames = new Set<string>();
  for (let pass = 0; pass < 3; pass++) {
    for (const { file, text } of texts) {
      for (const cls of findEnvClasses(text, file, envNames)) {
        envNames.add(cls.name);
      }
    }
  }
  for (const { file, text } of texts) {
    for (const cls of findEnvClasses(text, file, envNames)) {
      info.environments.push({
        spec: customEnvSpec(file, cls.name),
        label: cls.name,
        kind: 'custom',
        file,
        line: cls.line,
      });
    }
  }
  info.environments.unshift(...seenIds.values());
  info.trainingScripts = info.trainingScripts.filter((s) =>
    texts.some((t) => t.file === s.file && /gym|stable_baselines3|rllib|\.learn\s*\(/.test(t.text)),
  );

  const zips = await vscode.workspace.findFiles('**/*.zip', EXCLUDE_GLOB, 300);
  for (const uri of zips) {
    if (isSb3Zip(uri.fsPath)) {
      info.models.push({ file: uri.fsPath, label: displayPath(uri.fsPath), algorithm: guessAlgorithm(uri.fsPath) });
    }
  }

  info.frameworks = [...frameworks];
  return info;
}

export function hasRlSignals(info: ProjectInfo): boolean {
  return info.environments.length > 0 || info.models.length > 0 || info.frameworks.some((f) => /Gym|Baselines|RLlib|Zoo/.test(f));
}
