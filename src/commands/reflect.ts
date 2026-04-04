import * as vscode from "vscode";

import { executeCliCommand } from "./commandRuntime";
import { toErrorMessage } from "../runtime/errors";

export const REFLECT_COMMAND_ID = "grpctestify.reflect";

export function registerReflectCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    REFLECT_COMMAND_ID,
    async () => {
      const symbol = await vscode.window.showInputBox({
        title: "gRPCTestify: Reflect",
        prompt: "Enter service/method symbol (or leave empty)",
      });

      const args = ["reflect"];
      if (symbol && symbol.trim().length > 0) {
        args.push(symbol.trim());
      }

      try {
        const result = await executeCliCommand(args, {
          title: "gRPCTestify: Reflect",
        });
        if (result.stdout.trim().length > 0) {
          const doc = await vscode.workspace.openTextDocument({
            language: "markdown",
            content: result.stdout,
          });
          await vscode.window.showTextDocument(doc, { preview: false });
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Reflect failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
