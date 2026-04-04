import * as vscode from "vscode";

import { executeCliCommand, getActiveGctfFilePath } from "./commandRuntime";
import { decodeInspectReport, parseJsonContract } from "../runtime/contracts";
import { toErrorMessage } from "../runtime/errors";

export const INSPECT_COMMAND_ID = "grpctestify.inspect";

function renderInspectMarkdown(report: ReturnType<typeof decodeInspectReport>): string {
  const renderDiagnostic = (diagnostic: (typeof report.diagnostics)[number]) => {
    const location = `${diagnostic.range.start.line}:${diagnostic.range.start.column}`;
    return `- [${diagnostic.severity}] \`${diagnostic.code}\` at ${location} - ${diagnostic.message}`;
  };

  const lines: string[] = [];
  lines.push("# gRPCTestify Inspect");
  lines.push("");
  lines.push(`- File: \`${report.file}\``);
  lines.push(`- Parse time: **${report.parse_time_ms}ms**`);
  lines.push(`- Validation time: **${report.validation_time_ms}ms**`);
  if (report.inferred_rpc_mode) {
    lines.push(`- RPC mode: **${report.inferred_rpc_mode}**`);
  }
  lines.push(
    `- Diagnostics: **${report.diagnostics.length}** (semantic: ${report.semantic_diagnostics.length}, optimization: ${report.optimization_hints.length})`,
  );
  lines.push("");
  lines.push("## Quick read");
  if (
    report.diagnostics.length === 0 &&
    report.semantic_diagnostics.length === 0 &&
    report.optimization_hints.length === 0
  ) {
    lines.push("- No issues found by inspect.");
  } else {
    if (report.diagnostics.length > 0) {
      lines.push("- Parse/validation issues present.");
    }
    if (report.semantic_diagnostics.length > 0) {
      lines.push("- Semantic issues present.");
    }
    if (report.optimization_hints.length > 0) {
      lines.push("- Optimization hints are available.");
    }
  }

  const topDiagnostics = [...report.diagnostics, ...report.semantic_diagnostics]
    .slice(0, 8)
    .map(renderDiagnostic);

  if (topDiagnostics.length > 0) {
    lines.push("");
    lines.push("## Top diagnostics");
    lines.push(...topDiagnostics);
  }

  if (report.optimization_hints.length > 0) {
    lines.push("");
    lines.push("## Optimization hints");
    lines.push(...report.optimization_hints.slice(0, 8).map(renderDiagnostic));
  }

  lines.push("");
  lines.push("## Raw JSON");
  lines.push("```json");
  lines.push(JSON.stringify(report, null, 2));
  lines.push("```");
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
        const content = renderInspectMarkdown(report);
        const doc = await vscode.workspace.openTextDocument({
          language: "markdown",
          content,
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Inspect failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
