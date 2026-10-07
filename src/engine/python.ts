import { execFile } from 'child_process';
import * as vscode from 'vscode';

export interface PythonCommand {
  command: string;
  args: string[];
  /** Where the interpreter choice came from, for display. */
  source: 'setting' | 'python-extension' | 'path';
}

interface PythonExtensionApi {
  environments?: {
    getActiveEnvironmentPath(resource?: vscode.Uri): { path: string } | undefined;
    resolveEnvironment(env: { path: string }): Promise<{ executable?: { uri?: vscode.Uri } } | undefined>;
  };
}

function probe(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args, '-c', 'import sys; print(sys.executable)'],
      { timeout: 15000, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : stdout.toString().trim() || undefined),
    );
  });
}

async function fromPythonExtension(resource?: vscode.Uri): Promise<string | undefined> {
  const ext = vscode.extensions.getExtension<PythonExtensionApi>('ms-python.python');
  if (!ext) {
    return undefined;
  }
  try {
    const api = ext.isActive ? ext.exports : await ext.activate();
    const active = api?.environments?.getActiveEnvironmentPath(resource);
    if (!active?.path) {
      return undefined;
    }
    const resolved = await api.environments!.resolveEnvironment(active);
    return resolved?.executable?.uri?.fsPath ?? active.path;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the interpreter that runs the engine: explicit setting, then the Python extension's
 * active interpreter, then whatever is on PATH. Returns the absolute executable when possible.
 */
export async function resolvePython(resource?: vscode.Uri): Promise<PythonCommand> {
  const configured = vscode.workspace.getConfiguration('rlforge', resource).get<string>('pythonPath')?.trim();
  if (configured) {
    const exe = await probe(configured, []);
    if (!exe) {
      throw new Error(`The configured rlforge.pythonPath "${configured}" could not be executed.`);
    }
    return { command: exe, args: [], source: 'setting' };
  }

  const fromExt = await fromPythonExtension(resource);
  if (fromExt) {
    const exe = await probe(fromExt, []);
    if (exe) {
      return { command: exe, args: [], source: 'python-extension' };
    }
  }

  const candidates: [string, string[]][] =
    process.platform === 'win32'
      ? [['python', []], ['py', ['-3']], ['python3', []]]
      : [['python3', []], ['python', []]];
  for (const [command, args] of candidates) {
    const exe = await probe(command, args);
    if (exe) {
      return { command: exe, args: [], source: 'path' };
    }
  }
  throw new Error(
    'No Python interpreter found. Install Python 3.9+ or run "RLForge: Select Python Interpreter" to point RLForge at one.',
  );
}

export async function selectPythonInterpreter(): Promise<boolean> {
  const items: (vscode.QuickPickItem & { action: 'auto' | 'browse' | 'enter' })[] = [
    {
      label: '$(sync) Automatic',
      description: 'Use the Python extension interpreter, then PATH',
      action: 'auto',
    },
    { label: '$(folder-opened) Browse…', description: 'Pick a python executable', action: 'browse' },
    { label: '$(edit) Enter path…', description: 'Type an interpreter path or command', action: 'enter' },
  ];
  const picked = await vscode.window.showQuickPick(items, { title: 'RLForge: Python interpreter for the engine' });
  if (!picked) {
    return false;
  }
  let value: string | undefined;
  if (picked.action === 'auto') {
    value = '';
  } else if (picked.action === 'browse') {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      title: 'Select Python interpreter',
      filters: process.platform === 'win32' ? { Python: ['exe'] } : undefined,
    });
    value = uris?.[0]?.fsPath;
  } else {
    value = await vscode.window.showInputBox({
      title: 'Python interpreter',
      prompt: 'Path to python executable (e.g. .venv/bin/python or C:\\Python312\\python.exe)',
      value: vscode.workspace.getConfiguration('rlforge').get<string>('pythonPath') ?? '',
    });
  }
  if (value === undefined) {
    return false;
  }
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration('rlforge').update('pythonPath', value, target);
  return true;
}
