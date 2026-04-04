import * as vscode from "vscode";

import {
  checkArgsWithDefaults,
  executeCliCommand,
  getDefaultRunTargetPath,
} from "./commandRuntime";
import { parseJsonContract, decodeCheckReport } from "../runtime/contracts";
import { toErrorMessage } from "../runtime/errors";
import {
  clearCheckDiagnostics,
  publishCheckDiagnostics,
} from "../ui/checkDiagnostics";
import { getOutputChannel } from "../ui/outputChannels";

export const CHECK_COMMAND_ID = "grpctestify.check";

export function registerCheckCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    CHECK_COMMAND_ID,
    async () => {
      const output = getOutputChannel();
      const target = getDefaultRunTargetPath();
      if (!target) {
        const message =
          "No active .gctf file or workspace folder found to check.";
        void vscode.window.showWarningMessage(message);
        output.appendLine(message);
        return { status: "warning", message } as const;
      }

      try {
        const result = await executeCliCommand(
          checkArgsWithDefaults([target, "--format", "json"]),
          {
            title: "gRPCTestify: Check",
            expectedExitCodes: [0, 1],
          },
        );

        const report = parseJsonContract(
          result.stdout,
          decodeCheckReport,
          "check report",
        );
        publishCheckDiagnostics(report);
        const message = `Checked ${report.summary.total_files} file(s), errors: ${report.summary.total_errors}, warnings: ${report.summary.total_warnings}`;
        output.appendLine(message);
        if (report.summary.total_errors > 0) {
          void vscode.window.showWarningMessage(message);
          return { status: "warning", message } as const;
        } else {
          void vscode.window.showInformationMessage(message);
          return { status: "ok", message } as const;
        }
      } catch (error) {
        clearCheckDiagnostics();
        const message = `Check failed: ${toErrorMessage(error)}`;
        output.appendLine(message);
        void vscode.window.showErrorMessage(
          message,
        );
        return { status: "error", message } as const;
      }
    },
  );

  context.subscriptions.push(disposable);
}
