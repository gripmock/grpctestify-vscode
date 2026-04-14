import * as vscode from "vscode";

import { executeCliCommand, getActiveGctfFilePath } from "./commandRuntime";
import { decodeExplainReport, parseJsonContract } from "../runtime/contracts";
import { toErrorMessage } from "../runtime/errors";
import { getOutputChannel } from "../ui/outputChannels";

export const EXPLAIN_COMMAND_ID = "grpctestify.explain";

function renderExplainSimple(report: ReturnType<typeof decodeExplainReport>): string {
  const lines: string[] = [];
  lines.push("=== gRPCTestify Explain ===");
  
  if (report.summary) {
    if (report.summary.rpc_method) lines.push(`Method: ${report.summary.rpc_method}`);
    if (report.summary.request_format) lines.push(`Request: ${report.summary.request_format}`);
    if (report.summary.response_format) lines.push(`Response: ${report.summary.response_format}`);
  }
  
  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("");
    lines.push("Issues:");
    for (const d of report.diagnostics.slice(0, 5)) {
      lines.push(`  [${d.severity}] ${d.message}`);
    }
  }
  
  if (report.details) {
    if (report.details.address) lines.push(`Address: ${report.details.address}`);
    if (report.details.endpoint) lines.push(`Endpoint: ${report.details.endpoint}`);
  }
  
  lines.push("========================================");
  return lines.join("\n");
}

export function registerExplainCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    EXPLAIN_COMMAND_ID,
    async () => {
      const file = getActiveGctfFilePath();
      if (!file) {
        void vscode.window.showWarningMessage(
          "No active .gctf file to explain.",
        );
        return;
      }

      try {
        const result = await executeCliCommand(
          ["explain", file, "--format", "json"],
          {
            title: "gRPCTestify: Explain",
          },
        );
        const report = parseJsonContract(
          result.stdout,
          decodeExplainReport,
          "explain report",
        );
        const output = getOutputChannel();
        output.append(renderExplainSimple(report));
        output.show();
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Explain failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
