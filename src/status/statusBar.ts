import * as vscode from "vscode";

import {
  MIN_CLI_VERSION,
  resolveGrpctestifyBinary,
} from "../runtime/binaryResolver";
import { GrpctestifyError } from "../runtime/errors";

const STATUS_ACTIONS_COMMAND_ID = "grpctestify.status.actions";

export function registerStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  item.command = STATUS_ACTIONS_COMMAND_ID;
  item.text = "gRPCTestify: …";
  item.tooltip = "gRPCTestify status";
  item.show();
  context.subscriptions.push(item);

  const refresh = async () => {
    try {
      const binary = await resolveGrpctestifyBinary();
      if (binary.meetsMinVersion) {
        item.text = "gRPCTestify: ready";
        item.tooltip = `gRPCTestify ready\n${binary.resolvedPath}\nVersion: ${binary.version}`;
        item.backgroundColor = undefined;
      } else {
        item.text = "gRPCTestify: update";
        item.tooltip = `gRPCTestify v${binary.version} (>= ${MIN_CLI_VERSION} recommended)\n${binary.resolvedPath}\nClick for quick actions.`;
        item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
      }
    } catch (error) {
      if (
        error instanceof GrpctestifyError &&
        error.code === "BINARY_NOT_FOUND"
      ) {
        item.text = "gRPCTestify: missing";
        item.tooltip =
          "grpctestify binary is missing. Click for quick actions.";
      } else {
        item.text = "gRPCTestify: degraded";
        item.tooltip = "gRPCTestify is degraded. Click for quick actions.";
      }
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    }
  };

  const command = vscode.commands.registerCommand(
    STATUS_ACTIONS_COMMAND_ID,
    async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "Run", command: "grpctestify.run" },
          { label: "Check", command: "grpctestify.check" },
          { label: "Format", command: "grpctestify.fmt" },
          { label: "Restart LSP", command: "grpctestify.restartLsp" },
          { label: "Health Check", command: "grpctestify.health" },
        ],
        { title: "gRPCTestify quick actions" },
      );

      if (!choice) {
        return;
      }

      await vscode.commands.executeCommand(choice.command);
      await refresh();
    },
  );

  context.subscriptions.push(command);

  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("grpctestify.binary.path")) {
      void refresh();
    }
  });

  context.subscriptions.push(configWatcher);
  void refresh();
}
