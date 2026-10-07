import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';
import { PythonCommand, resolvePython } from './python';

export type EngineStatus = 'stopped' | 'starting' | 'ready' | 'error';

export interface EngineState {
  status: EngineStatus;
  python?: string;
  pythonSource?: PythonCommand['source'];
  hello?: Record<string, unknown>;
  error?: string;
}

export interface EngineEvent {
  event: string;
  data: Record<string, unknown>;
}

export class EngineRequestError extends Error {
  constructor(message: string, readonly traceback?: string) {
    super(message);
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

const STDERR_TAIL = 40;

export class EngineClient implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private starting: Promise<EngineState> | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrTail: string[] = [];
  private _state: EngineState = { status: 'stopped' };

  private readonly _onEvent = new vscode.EventEmitter<EngineEvent>();
  readonly onEvent = this._onEvent.event;
  private readonly _onState = new vscode.EventEmitter<EngineState>();
  readonly onState = this._onState.event;

  constructor(
    private readonly enginePath: string,
    private readonly output: vscode.OutputChannel,
  ) {}

  get state(): EngineState {
    return this._state;
  }

  private setState(state: EngineState): void {
    this._state = state;
    this._onState.fire(state);
  }

  start(): Promise<EngineState> {
    if (this._state.status === 'ready' && this.proc) {
      return Promise.resolve(this._state);
    }
    if (!this.starting) {
      this.starting = this.doStart().finally(() => (this.starting = undefined));
    }
    return this.starting;
  }

  private async doStart(): Promise<EngineState> {
    this.setState({ status: 'starting' });
    const folder = vscode.workspace.workspaceFolders?.[0];
    let python: PythonCommand;
    try {
      python = await resolvePython(folder?.uri);
    } catch (err) {
      const state: EngineState = { status: 'error', error: (err as Error).message };
      this.setState(state);
      return state;
    }

    const env = {
      ...process.env,
      PYTHONPATH: [this.enginePath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    };
    this.output.appendLine(`[rlforge] starting engine: ${python.command} -m rlforge_engine (${python.source})`);
    this.stderrTail = [];

    const proc = spawn(python.command, [...python.args, '-u', '-m', 'rlforge_engine'], {
      cwd: folder?.uri.fsPath,
      env,
      windowsHide: true,
    });
    this.proc = proc;

    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line));
    readline.createInterface({ input: proc.stderr }).on('line', (line) => {
      this.output.appendLine(line);
      this.stderrTail.push(line);
      if (this.stderrTail.length > STDERR_TAIL) {
        this.stderrTail.shift();
      }
    });
    proc.on('error', (err) => this.onExit(proc, `Failed to start Python: ${err.message}`));
    proc.on('exit', (code, signal) => this.onExit(proc, `Engine exited (code ${code ?? signal}).`));

    try {
      const hello = await this.request<Record<string, unknown>>('hello', {}, 60000);
      const state: EngineState = { status: 'ready', python: python.command, pythonSource: python.source, hello };
      this.setState(state);
      return state;
    } catch (err) {
      const detail = this.stderrTail.slice(-8).join('\n');
      const state: EngineState = {
        status: 'error',
        python: python.command,
        error: `${(err as Error).message}${detail ? `\n${detail}` : ''}`,
      };
      this.kill();
      this.setState(state);
      return state;
    }
  }

  private onLine(line: string): void {
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: string; traceback?: string } & Partial<EngineEvent>;
    try {
      msg = JSON.parse(line);
    } catch {
      this.output.appendLine(`[engine stdout] ${line}`);
      return;
    }
    if (msg.event) {
      this._onEvent.fire({ event: msg.event, data: msg.data ?? {} });
      return;
    }
    if (typeof msg.id !== 'number') {
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) {
      return;
    }
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) {
      pending.resolve(msg.result);
    } else {
      if (msg.traceback) {
        this.output.appendLine(msg.traceback);
      }
      pending.reject(new EngineRequestError(msg.error ?? 'Unknown engine error', msg.traceback));
    }
  }

  private onExit(proc: ChildProcessWithoutNullStreams, reason: string): void {
    if (this.proc !== proc) {
      return;
    }
    this.proc = undefined;
    this.output.appendLine(`[rlforge] ${reason}`);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    if (this._state.status !== 'error') {
      const crashed = this._state.status === 'ready';
      this.setState(
        crashed
          ? { status: 'error', python: this._state.python, error: `${reason}\n${this.stderrTail.slice(-8).join('\n')}` }
          : { status: 'stopped' },
      );
    }
  }

  request<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 120000): Promise<T> {
    const proc = this.proc;
    if (!proc) {
      return Promise.reject(new Error('RLForge engine is not running.'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Engine request "${cmd}" timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  private kill(): void {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc) {
      return;
    }
    try {
      proc.stdin.write(JSON.stringify({ cmd: 'shutdown' }) + '\n');
    } catch {
      // process already gone
    }
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill();
      }
    }, 1500);
  }

  async restart(): Promise<EngineState> {
    this.stop();
    return this.start();
  }

  stop(): void {
    this.kill();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Engine stopped.'));
    }
    this.pending.clear();
    this.setState({ status: 'stopped' });
  }

  dispose(): void {
    this.stop();
    this._onEvent.dispose();
    this._onState.dispose();
  }
}
