import * as vscode from "vscode";

import { executeCliCommand, getActiveGctfFilePath } from "./commandRuntime";
import { toErrorMessage } from "../runtime/errors";

export const FMT_COMMAND_ID = "grpctestify.fmt";

export function registerFmtCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    FMT_COMMAND_ID,
    async () => {
      const file = getActiveGctfFilePath();
      if (!file) {
        void vscode.window.showWarningMessage(
          "No active .gctf file to format.",
        );
        return;
      }

      try {
        await executeCliCommand(["fmt", file, "--write"], {
          title: "gRPCTestify: Format",
        });
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.document.isUntitled) {
          await editor.document.save();
        }
        void vscode.window.showInformationMessage("Formatting completed.");
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Format failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
