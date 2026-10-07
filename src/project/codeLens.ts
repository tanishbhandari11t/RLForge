import * as vscode from 'vscode';
import { customEnvSpec, findEnvClasses, findMakeCalls } from './scanner';

export class RlCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  private knownEnvNames = new Set<string>();

  setKnownEnvNames(names: Iterable<string>): void {
    this.knownEnvNames = new Set(names);
    this._onDidChange.fire();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('rlforge').get<boolean>('codeLens.enabled', true)) {
      return [];
    }
    const text = document.getText();
    const lenses: vscode.CodeLens[] = [];
    const add = (line: number, spec: string, label: string) => {
      const range = new vscode.Range(line, 0, line, 0);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(play) Watch ${label} in RLForge Arena`,
          command: 'rlforge.openArena',
          arguments: [{ env: spec, autoLaunch: true }],
        }),
        new vscode.CodeLens(range, {
          title: '$(search) Inspect',
          command: 'rlforge.inspectEnvironment',
          arguments: [{ env: spec }],
        }),
      );
    };

    for (const call of findMakeCalls(text)) {
      add(document.positionAt(call.index).line, call.id, call.id);
    }
    for (const cls of findEnvClasses(text, document.uri.fsPath, this.knownEnvNames)) {
      add(cls.line, customEnvSpec(document.uri.fsPath, cls.name), cls.name);
    }
    return lenses;
  }
}
