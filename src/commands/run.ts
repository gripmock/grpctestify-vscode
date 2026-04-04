import * as vscode from "vscode";
import * as path from "node:path";

import {
  executeCliCommand,
  getDefaultRunTargetPath,
  runArgsWithDefaults,
} from "./commandRuntime";
import { toErrorMessage } from "../runtime/errors";
import { setRunStatus } from "../tree/runStatus";

export const RUN_COMMAND_ID = "grpctestify.run";

export async function runTarget(
  target: string,
  title = "gRPCTestify: Run",
): Promise<number> {
  if (target.endsWith(".gctf")) {
    setRunStatus(target, "running");
  }

  const result = await executeCliCommand(runArgsWithDefaults([target]), {
    title,
    expectedExitCodes: [0, 1],
  });

  if (target.endsWith(".gctf")) {
    setRunStatus(target, result.exitCode === 0 ? "passed" : "failed");
  }

  return result.exitCode;
}

export function registerRunCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    RUN_COMMAND_ID,
    async () => {
      const target = getDefaultRunTargetPath();
      if (!target) {
        void vscode.window.showWarningMessage(
          "No active .gctf file or workspace folder found to run.",
        );
        return;
      }

      try {
        const exitCode = await runTarget(target);
        if (exitCode === 0) {
          void vscode.window.showInformationMessage(
            "gRPCTestify run completed successfully.",
          );
        } else {
          const label = path.basename(target);
          void vscode.window.showWarningMessage(
            `gRPCTestify run finished with failures for ${label}.`,
          );
        }
      } catch (error) {
        if (target.endsWith(".gctf")) {
          setRunStatus(target, "failed");
        }
        void vscode.window.showErrorMessage(
          `Run failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
