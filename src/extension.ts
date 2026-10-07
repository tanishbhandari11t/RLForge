import * as vscode from 'vscode';
import { EngineClient } from './engine/engineClient';
import { selectPythonInterpreter } from './engine/python';
import { ArenaPanel, PanelCommand, PanelDeps } from './panel/arenaPanel';
import { RlCodeLensProvider } from './project/codeLens';
import { hasRlSignals, ProjectInfo, scanProject } from './project/scanner';
import { ProjectTreeProvider } from './project/treeView';

const POPULAR_ENVS = ['CartPole-v1', 'MountainCar-v0', 'Acrobot-v1', 'Pendulum-v1', 'LunarLander-v3', 'FrozenLake-v1', 'Taxi-v3'];

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RLForge');
  const engine = new EngineClient(vscode.Uri.joinPath(context.extensionUri, 'engine').fsPath, output);
  const tree = new ProjectTreeProvider();
  const codeLens = new RlCodeLensProvider();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'rlforge.openArena';
  status.text = '$(play-circle) RLForge';
  status.tooltip = 'Open the RLForge Agent Arena';

  let project: ProjectInfo | undefined;
  let scanInFlight: Promise<ProjectInfo | undefined> | undefined;

  const rescan = (): Promise<ProjectInfo | undefined> => {
    if (scanInFlight) {
      return scanInFlight;
    }
    tree.setProject(project, true);
    scanInFlight = scanProject()
      .then((info) => {
        project = info;
        tree.setProject(info);
        codeLens.setKnownEnvNames(info.environments.filter((e) => e.kind === 'custom').map((e) => e.label));
        ArenaPanel.current?.postProject(info);
        if (hasRlSignals(info)) {
          status.show();
        } else {
          status.hide();
        }
        promptHealthForNewEnvs(info);
        return info;
      })
      .catch((err) => {
        output.appendLine(`[rlforge] project scan failed: ${err}`);
        tree.setProject(project);
        return project;
      })
      .finally(() => (scanInFlight = undefined));
    return scanInFlight;
  };

  const deps: PanelDeps = { extensionUri: context.extensionUri, engine, output, getProject: () => project, rescan };
  const openPanel = (command?: PanelCommand) => ArenaPanel.show(deps, command);

  const pickEnvironment = async (title: string): Promise<string | undefined> => {
    const detected = project?.environments ?? [];
    const items: (vscode.QuickPickItem & { spec?: string })[] = [
      ...(detected.length ? [{ label: 'In this project', kind: vscode.QuickPickItemKind.Separator }] : []),
      ...detected.map((e) => ({
        label: `$(${e.kind === 'custom' ? 'symbol-class' : 'globe'}) ${e.label}`,
        description: e.kind === 'custom' ? e.spec : undefined,
        spec: e.spec,
      })),
      { label: 'Popular', kind: vscode.QuickPickItemKind.Separator },
      ...POPULAR_ENVS.filter((id) => !detected.some((e) => e.spec === id)).map((id) => ({ label: `$(globe) ${id}`, spec: id })),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(edit) Enter an environment id or file.py:ClassName…' },
    ];
    const picked = await vscode.window.showQuickPick(items, { title, matchOnDescription: true });
    if (!picked) {
      return undefined;
    }
    if (picked.spec) {
      return picked.spec;
    }
    return vscode.window.showInputBox({
      title,
      prompt: 'A registered Gymnasium id (e.g. CartPole-v1) or path/to/env.py:ClassName',
    });
  };

  type ItemNode = { type: 'env'; spec: string } | { type: 'model'; file: string };

  /** Env from a CodeLens/command argument, a tree node, or a quick pick. */
  const resolveEnv = async (arg: unknown, title: string): Promise<string | undefined> => {
    if (arg && typeof arg === 'object') {
      const a = arg as Partial<PanelCommand> & Partial<{ type: string; spec: string }>;
      if (a.env) {
        return a.env;
      }
      if (a.type === 'env' && a.spec) {
        return a.spec;
      }
    }
    return pickEnvironment(title);
  };

  const normalize = (s: string) => s.toLowerCase().replace(/-v\d+$/, '').replace(/[^a-z0-9]/g, '');
  /** Best-effort env guess from a model filename such as ppo_cartpole.zip or lunarlander_dqn.zip. */
  const guessEnvForModel = (file: string): string | undefined => {
    const name = normalize(file.split(/[\\/]/).pop() ?? '');
    const candidates = [...(project?.environments.map((e) => e.spec) ?? []), ...POPULAR_ENVS];
    return candidates
      .map((spec) => ({ spec, key: normalize(spec.includes(':') ? spec.split(':').pop()! : spec) }))
      .filter((c) => c.key.length >= 4 && name.includes(c.key))
      .sort((a, b) => b.key.length - a.key.length)[0]?.spec;
  };

  const watchModel = (file: string) => {
    const env = guessEnvForModel(file);
    openPanel({ tab: 'arena', model: file, ...(env ? { env, autoLaunch: true } : {}) });
  };

  const KNOWN_CUSTOM_KEY = 'rlforge.knownCustomEnvs';
  const promptHealthForNewEnvs = (info: ProjectInfo) => {
    const custom = info.environments.filter((e) => e.kind === 'custom');
    const known = new Set(context.workspaceState.get<string[]>(KNOWN_CUSTOM_KEY, []));
    const fresh = custom.filter((e) => !known.has(e.spec));
    if (!fresh.length) {
      return;
    }
    void context.workspaceState.update(KNOWN_CUSTOM_KEY, [...known, ...fresh.map((e) => e.spec)]);
    const first = fresh[0];
    const more = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : '';
    void vscode.window
      .showInformationMessage(
        `RLForge found a custom environment: ${first.label}${more}. Run a health check (check_env, determinism, NaN/space violations)?`,
        'Run Health Check',
        'Fuzz It',
        'Not now',
      )
      .then((choice) => {
        if (choice === 'Run Health Check') {
          openPanel({ tab: 'health', env: first.spec, run: true });
        } else if (choice === 'Fuzz It') {
          openPanel({ tab: 'fuzzer', env: first.spec, run: true });
        }
      });
  };

  context.subscriptions.push(
    output,
    engine,
    status,
    vscode.window.registerTreeDataProvider('rlforge.project', tree),
    vscode.window.registerTreeDataProvider('rlforge.launcher', { getTreeItem: (i: vscode.TreeItem) => i, getChildren: () => [] }),
    vscode.languages.registerCodeLensProvider({ language: 'python', scheme: 'file' }, codeLens),

    vscode.commands.registerCommand('rlforge.openArena', (arg?: PanelCommand) => {
      openPanel({ tab: 'arena', ...(arg && typeof arg === 'object' && !('fsPath' in arg) ? arg : {}) });
    }),
    vscode.commands.registerCommand('rlforge.inspectEnvironment', async (arg?: PanelCommand) => {
      const env = arg?.env ?? (await pickEnvironment('RLForge: Inspect environment'));
      if (env) {
        openPanel({ tab: 'inspector', env });
      }
    }),
    vscode.commands.registerCommand('rlforge.watchItem', (node: ItemNode) => {
      if (node.type === 'env') {
        openPanel({ tab: 'arena', env: node.spec, autoLaunch: true });
      } else {
        watchModel(node.file);
      }
    }),
    vscode.commands.registerCommand('rlforge.testEnvironment', async (arg?: unknown) => {
      const env = await resolveEnv(arg, 'RLForge: Test environment health');
      if (env) {
        openPanel({ tab: 'health', env, run: true });
      }
    }),
    vscode.commands.registerCommand('rlforge.fuzzEnvironment', async (arg?: unknown) => {
      const env = await resolveEnv(arg, 'RLForge: Fuzz environment');
      if (env) {
        openPanel({ tab: 'fuzzer', env, run: true });
      }
    }),
    vscode.commands.registerCommand('rlforge.watchModel', async (uri?: vscode.Uri) => {
      let file = uri instanceof vscode.Uri ? uri.fsPath : undefined;
      if (!file) {
        const picked = await vscode.window.showOpenDialog({
          title: 'Select a Stable-Baselines3 model (.zip)',
          filters: { 'SB3 model': ['zip'] },
          canSelectMany: false,
        });
        file = picked?.[0]?.fsPath;
      }
      if (file) {
        watchModel(file);
      }
    }),
    vscode.commands.registerCommand('rlforge.openReplays', () => openPanel({ tab: 'replay' })),
    vscode.commands.registerCommand('rlforge.inspectItem', (node: ItemNode) => {
      if (node.type === 'env') {
        openPanel({ tab: 'inspector', env: node.spec });
      }
    }),
    vscode.commands.registerCommand('rlforge.scanProject', async () => {
      const info = await rescan();
      if (info) {
        vscode.window.setStatusBarMessage(
          `RLForge: ${info.environments.length} environment(s), ${info.models.length} model(s) in ${info.pythonFiles} Python files`,
          5000,
        );
      }
    }),
    vscode.commands.registerCommand('rlforge.selectPythonInterpreter', async () => {
      if (await selectPythonInterpreter()) {
        await engine.restart();
      }
    }),
    vscode.commands.registerCommand('rlforge.restartEngine', () => engine.restart()),
    vscode.commands.registerCommand('rlforge.showEngineLog', () => output.show()),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('rlforge.pythonPath') && engine.state.status !== 'stopped') {
        void engine.restart();
      }
      if (e.affectsConfiguration('rlforge.codeLens')) {
        codeLens.refresh();
      }
    }),
  );

  let debounce: NodeJS.Timeout | undefined;
  const scheduleRescan = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void rescan(), 1500);
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{py,zip}');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(scheduleRescan),
    watcher.onDidChange(scheduleRescan),
    watcher.onDidDelete(scheduleRescan),
    { dispose: () => clearTimeout(debounce) },
  );

  void rescan();
}

export function deactivate(): void {
  ArenaPanel.current?.dispose();
}
