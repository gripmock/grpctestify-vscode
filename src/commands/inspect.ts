import * as vscode from "vscode";

import { executeCliCommand, getActiveGctfFilePath } from "./commandRuntime";
import { decodeInspectReport, parseJsonContract } from "../runtime/contracts";
import { toErrorMessage } from "../runtime/errors";
import { getOutputChannel } from "../ui/outputChannels";

export const INSPECT_COMMAND_ID = "grpctestify.inspect";

function renderInspectReport(report: ReturnType<typeof decodeInspectReport>): string {
  const lines: string[] = [];
  lines.push(`=== gRPCTestify Inspect: ${report.file} ===`);
  lines.push(`Parse: ${report.parse_time_ms}ms | Validation: ${report.validation_time_ms}ms`);
  
  if (report.inferred_rpc_mode) {
    lines.push(`RPC mode: ${report.inferred_rpc_mode}`);
  }
  
  const totalIssues = report.diagnostics.length + report.semantic_diagnostics.length;
  lines.push(`Issues: ${totalIssues} (parse: ${report.diagnostics.length}, semantic: ${report.semantic_diagnostics.length})`);
  
  if (report.diagnostics.length === 0 && report.semantic_diagnostics.length === 0 && report.optimization_hints.length === 0) {
    lines.push("No issues found.");
  } else {
    if (report.diagnostics.length > 0) {
      lines.push("");
      lines.push("Parse/Validation errors:");
      for (const d of report.diagnostics.slice(0, 5)) {
        lines.push(`  [${d.severity}] ${d.code}: ${d.message}`);
      }
    }
    if (report.semantic_diagnostics.length > 0) {
      lines.push("");
      lines.push("Semantic errors:");
      for (const d of report.semantic_diagnostics.slice(0, 5)) {
        lines.push(`  [${d.severity}] ${d.code}: ${d.message}`);
      }
    }
    if (report.optimization_hints.length > 0) {
      lines.push("");
      lines.push("Optimization hints:");
      for (const d of report.optimization_hints.slice(0, 5)) {
        lines.push(`  [${d.severity}] ${d.code}: ${d.message}`);
      }
    }
  }
  
  lines.push("");
  lines.push("========================================");
  return lines.join("\n");
}

export function registerInspectCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    INSPECT_COMMAND_ID,
    async () => {
      const file = getActiveGctfFilePath();
      if (!file) {
        void vscode.window.showWarningMessage(
          "No active .gctf file to inspect.",
        );
        return;
      }

      try {
        const result = await executeCliCommand(
          ["inspect", file, "--format", "json"],
          {
            title: "gRPCTestify: Inspect",
          },
        );
        const report = parseJsonContract(
          result.stdout,
          decodeInspectReport,
          "inspect report",
        );
        const output = getOutputChannel();
        output.append(renderInspectReport(report));
        output.show();
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Inspect failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
