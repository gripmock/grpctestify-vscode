import * as vscode from "vscode";

import { executeCliCommand } from "./commandRuntime";
import { toErrorMessage } from "../runtime/errors";

export const PLAY_COMMAND_ID = "grpctestify.play";

export function registerPlayCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    PLAY_COMMAND_ID,
    async () => {
      try {
        const result = await executeCliCommand(["play", "--open"], {
          title: "gRPCTestify: Play",
        });
        if (result.stderr.trim().length > 0) {
          void vscode.window.showInformationMessage(
            result.stderr.trim(),
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Play failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
