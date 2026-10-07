import * as crypto from 'crypto';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { EngineClient, EngineRequestError } from '../engine/engineClient';
import { ProjectInfo } from '../project/scanner';

export interface PanelCommand {
  tab?: 'arena' | 'inspector' | 'health' | 'fuzzer' | 'replay' | 'rewards';
  env?: string;
  model?: string;
  autoLaunch?: boolean;
  run?: boolean;
}

export interface PanelDeps {
  extensionUri: vscode.Uri;
  engine: EngineClient;
  output: vscode.OutputChannel;
  getProject: () => ProjectInfo | undefined;
  rescan: () => Promise<ProjectInfo | undefined>;
}

interface WebviewRequest {
  type: 'request';
  id: number;
  cmd: string;
  args?: Record<string, unknown>;
}

type WebviewMessage = WebviewRequest | { type: 'ready' };

export class ArenaPanel implements vscode.Disposable {
  static current: ArenaPanel | undefined;
  private static readonly viewType = 'rlforge.arena';

  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private queued: PanelCommand[] = [];

  static show(deps: PanelDeps, command?: PanelCommand): ArenaPanel {
    if (ArenaPanel.current) {
      ArenaPanel.current.panel.reveal(vscode.ViewColumn.Active);
    } else {
      const panel = vscode.window.createWebviewPanel(ArenaPanel.viewType, 'RLForge', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(deps.extensionUri, 'media'),
          vscode.Uri.joinPath(deps.extensionUri, 'webview-ui', 'dist'),
        ],
      });
      ArenaPanel.current = new ArenaPanel(panel, deps);
    }
    if (command) {
      ArenaPanel.current.send(command);
    }
    return ArenaPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: PanelDeps,
  ) {
    panel.iconPath = vscode.Uri.joinPath(deps.extensionUri, 'media', 'icon.png');
    panel.webview.html = this.html();
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg)),
      deps.engine.onEvent((e) => this.post({ type: 'engineEvent', event: e.event, data: e.data })),
      deps.engine.onState((state) => this.post({ type: 'engineState', state })),
    );
    void deps.engine.start();
  }

  send(command: PanelCommand): void {
    if (this.ready) {
      this.post({ type: 'command', command });
    } else {
      this.queued.push(command);
    }
  }

  postProject(project: ProjectInfo | undefined): void {
    this.post({ type: 'project', project });
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    if (msg.type === 'ready') {
      this.ready = true;
      const config = vscode.workspace.getConfiguration('rlforge');
      this.post({
        type: 'init',
        engine: this.deps.engine.state,
        project: this.deps.getProject(),
        settings: {
          defaultSeed: config.get<number>('defaultSeed', 42),
          autoReset: config.get<boolean>('autoReset', true),
        },
      });
      for (const command of this.queued.splice(0)) {
        this.post({ type: 'command', command });
      }
      return;
    }
    if (msg.type !== 'request') {
      return;
    }
    try {
      const result = msg.cmd.startsWith('ui:') ? await this.handleUi(msg.cmd, msg.args ?? {}) : await this.forward(msg);
      this.post({ type: 'response', id: msg.id, ok: true, result });
    } catch (err) {
      this.post({
        type: 'response',
        id: msg.id,
        ok: false,
        error: (err as Error).message,
        traceback: err instanceof EngineRequestError ? err.traceback : undefined,
      });
    }
  }

  private async forward(msg: WebviewRequest): Promise<unknown> {
    const engine = this.deps.engine;
    if (engine.state.status !== 'ready') {
      const state = await engine.start();
      if (state.status !== 'ready') {
        throw new Error(state.error ?? 'RLForge engine is not running.');
      }
    }
    return engine.request(msg.cmd, msg.args ?? {});
  }

  private async handleUi(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    switch (cmd) {
      case 'ui:openFile': {
        const file = String(args.file);
        if (!fs.existsSync(file)) {
          throw new Error(`File not found: ${file}`);
        }
        const line = Math.max(0, Number(args.line ?? 1) - 1);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          selection: new vscode.Range(line, 0, line, 0),
        });
        return null;
      }
      case 'ui:pickModel': {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          title: 'Select a Stable-Baselines3 model (.zip)',
          filters: { 'SB3 model': ['zip'] },
          defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        });
        return uris?.[0]?.fsPath ?? null;
      }
      case 'ui:installPackages': {
        const packages = (args.packages as string[]) ?? [];
        const python = this.deps.engine.state.python ?? 'python';
        const terminal = vscode.window.createTerminal({ name: 'RLForge: install' });
        terminal.show();
        const quoted = packages.map((p) => `"${p}"`).join(' ');
        const powershell = /pwsh|powershell/i.test(vscode.env.shell);
        terminal.sendText(`${powershell ? '& ' : ''}"${python}" -m pip install ${quoted}`);
        return null;
      }
      case 'ui:restartEngine':
        await this.deps.engine.restart();
        return null;
      case 'ui:selectPython':
        await vscode.commands.executeCommand('rlforge.selectPythonInterpreter');
        return null;
      case 'ui:showLog':
        this.deps.output.show(true);
        return null;
      case 'ui:scanProject':
        return (await this.deps.rescan()) ?? null;
      default:
        throw new Error(`Unknown UI command ${cmd}`);
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const dist = vscode.Uri.joinPath(this.deps.extensionUri, 'webview-ui', 'dist', 'assets');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'index.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'index.css'));
    const mark = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'media', 'mark.png'));
    const logo = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'media', 'logo.png'));
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const assets = JSON.stringify({ mark: mark.toString(), logo: logo.toString() });
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${style}" />
  <title>RLForge</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__RLFORGE_ASSETS__ = ${assets};</script>
  <script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    if (ArenaPanel.current !== this) {
      return;
    }
    ArenaPanel.current = undefined;
    void this.deps.engine.request('unload').catch(() => undefined);
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}
