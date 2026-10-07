import * as vscode from 'vscode';
import { displayPath, ProjectInfo } from './scanner';

type Node =
  | { type: 'action'; label: string; icon: string; command: vscode.Command; description?: string }
  | { type: 'section'; id: string; label: string; icon: string; children: Node[] }
  | { type: 'env'; label: string; spec: string; file: string; line: number; custom: boolean }
  | { type: 'model'; label: string; file: string; algorithm?: string }
  | { type: 'file'; label: string; file: string; line: number; icon: string; description?: string }
  | { type: 'info'; label: string; icon: string; description?: string };

export class ProjectTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private project: ProjectInfo | undefined;
  private scanning = false;

  setProject(project: ProjectInfo | undefined, scanning = false): void {
    this.project = project;
    this.scanning = scanning;
    this._onDidChange.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.type) {
      case 'action': {
        const item = new vscode.TreeItem(node.label);
        item.iconPath = new vscode.ThemeIcon(node.icon, new vscode.ThemeColor('charts.blue'));
        item.command = node.command;
        item.description = node.description;
        return item;
      }
      case 'section': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = node.id;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.description = `${node.children.length}`;
        return item;
      }
      case 'env': {
        const item = new vscode.TreeItem(node.label);
        item.contextValue = 'rlforge.env';
        item.iconPath = new vscode.ThemeIcon(node.custom ? 'symbol-class' : 'globe');
        item.description = node.custom ? displayPath(node.file) : undefined;
        item.tooltip = new vscode.MarkdownString(
          `**${node.label}**\n\n${node.custom ? 'Custom environment' : 'Registered Gymnasium environment'}\n\n` +
            `Found in \`${displayPath(node.file)}:${node.line + 1}\`\n\nClick to watch it in the Agent Arena.`,
        );
        item.command = { command: 'rlforge.watchItem', title: 'Watch in Arena', arguments: [node] };
        return item;
      }
      case 'model': {
        const item = new vscode.TreeItem(node.label);
        item.contextValue = 'rlforge.model';
        item.iconPath = new vscode.ThemeIcon('package');
        item.description = node.algorithm;
        item.tooltip = `Stable-Baselines3 model\n${node.file}\n\nClick to watch this agent play in the Arena.`;
        item.command = { command: 'rlforge.watchItem', title: 'Watch in Arena', arguments: [node] };
        return item;
      }
      case 'file': {
        const item = new vscode.TreeItem(node.label);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.description = node.description;
        item.resourceUri = vscode.Uri.file(node.file);
        item.command = {
          command: 'vscode.open',
          title: 'Open',
          arguments: [vscode.Uri.file(node.file), { selection: new vscode.Range(node.line, 0, node.line, 0) }],
        };
        return item;
      }
      case 'info': {
        const item = new vscode.TreeItem(node.label);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.description = node.description;
        return item;
      }
    }
  }

  getChildren(node?: Node): Node[] {
    if (node) {
      return node.type === 'section' ? node.children : [];
    }
    const roots: Node[] = [
      {
        type: 'action',
        label: 'Agent Arena',
        icon: 'play-circle',
        description: 'watch your agent play',
        command: { command: 'rlforge.openArena', title: 'Open Agent Arena' },
      },
      {
        type: 'action',
        label: 'Test Environment',
        icon: 'pulse',
        description: 'health check',
        command: { command: 'rlforge.testEnvironment', title: 'Test Environment' },
      },
      {
        type: 'action',
        label: 'Fuzzer',
        icon: 'bug',
        description: 'find & replay failures',
        command: { command: 'rlforge.fuzzEnvironment', title: 'Fuzz Environment' },
      },
      {
        type: 'action',
        label: 'Episode Replays',
        icon: 'history',
        description: 'recorded episodes',
        command: { command: 'rlforge.openReplays', title: 'Episode Replays' },
      },
      {
        type: 'action',
        label: 'Environment Inspector',
        icon: 'search',
        description: 'spaces, rewards, metadata',
        command: { command: 'rlforge.inspectEnvironment', title: 'Inspect Environment' },
      },
    ];
    if (this.scanning && !this.project) {
      roots.push({ type: 'info', label: 'Scanning project…', icon: 'loading~spin' });
      return roots;
    }
    const p = this.project;
    if (!p) {
      return roots;
    }

    if (p.frameworks.length) {
      roots.push({ type: 'info', label: 'Detected', icon: 'check', description: p.frameworks.join(' · ') });
    }
    const registered = p.environments.filter((e) => e.kind === 'registered');
    const custom = p.environments.filter((e) => e.kind === 'custom');
    if (registered.length) {
      roots.push({
        type: 'section',
        id: 'envs',
        label: 'Environments',
        icon: 'globe',
        children: registered.map((e) => ({ type: 'env', label: e.label, spec: e.spec, file: e.file, line: e.line, custom: false })),
      });
    }
    if (custom.length) {
      roots.push({
        type: 'section',
        id: 'custom',
        label: 'Custom Environments',
        icon: 'symbol-class',
        children: custom.map((e) => ({ type: 'env', label: e.label, spec: e.spec, file: e.file, line: e.line, custom: true })),
      });
    }
    if (p.models.length) {
      roots.push({
        type: 'section',
        id: 'models',
        label: 'Trained Models',
        icon: 'package',
        children: p.models.map((m) => ({ type: 'model', label: m.label, file: m.file, algorithm: m.algorithm })),
      });
    }
    if (p.algorithms.length) {
      roots.push({
        type: 'section',
        id: 'algos',
        label: 'Algorithms',
        icon: 'hubot',
        children: p.algorithms.map((a) => ({
          type: 'file',
          label: a.name,
          file: a.file,
          line: a.line,
          icon: 'hubot',
          description: displayPath(a.file),
        })),
      });
    }
    if (p.trainingScripts.length) {
      roots.push({
        type: 'section',
        id: 'training',
        label: 'Training Scripts',
        icon: 'flame',
        children: p.trainingScripts.map((s) => ({
          type: 'file',
          label: displayPath(s.file),
          file: s.file,
          line: s.line,
          icon: 'file-code',
        })),
      });
    }
    if (!p.environments.length && !p.models.length) {
      roots.push({
        type: 'info',
        label: 'No RL environments detected',
        icon: 'info',
        description: 'add gym.make(...) or a gym.Env subclass',
      });
    }
    return roots;
  }
}
