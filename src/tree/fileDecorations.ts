import * as vscode from "vscode";

import { getRunStatus, onDidChangeRunStatus } from "./runStatus";

class GrpctestifyFileDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<undefined | vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  provideFileDecoration(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.FileDecoration | undefined {
    if (uri.scheme !== "file" || !uri.fsPath.endsWith(".gctf")) {
      return undefined;
    }

    const status = getRunStatus(uri.fsPath);
    switch (status) {
      case "passed":
        return new vscode.FileDecoration(
          "\u2713",
          "Test passed",
          new vscode.ThemeColor("testing.iconPassed"),
        );
      case "failed":
        return new vscode.FileDecoration(
          "\u2717",
          "Test failed",
          new vscode.ThemeColor("testing.iconFailed"),
        );
      case "running":
        return new vscode.FileDecoration(
          "\u25B6",
          "Test running",
          new vscode.ThemeColor("testing.iconQueued"),
        );
      default:
        return undefined;
    }
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }
}

export function registerFileDecorations(context: vscode.ExtensionContext): void {
  const provider = new GrpctestifyFileDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(provider),
  );
  context.subscriptions.push(
    onDidChangeRunStatus(() => provider.refresh()),
  );
}
