import * as vscode from "vscode";

export const RESTART_LSP_COMMAND_ID = "grpctestify.restartLsp";

export function registerRestartLspCommand(
  context: vscode.ExtensionContext,
  restartHandler: () => Promise<void>,
): void {
  const disposable = vscode.commands.registerCommand(
    RESTART_LSP_COMMAND_ID,
    async () => {
      await restartHandler();
      void vscode.window.showInformationMessage("gRPCTestify LSP restarted.");
    },
  );

  context.subscriptions.push(disposable);
}
