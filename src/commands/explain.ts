import * as vscode from "vscode";

import { executeCliCommand, getActiveGctfFilePath } from "./commandRuntime";
import { decodeExplainReport, parseJsonContract } from "../runtime/contracts";
import { toErrorMessage } from "../runtime/errors";

export const EXPLAIN_COMMAND_ID = "grpctestify.explain";

function renderKeyValueLines(
  value: unknown,
  indent = 0,
  maxDepth = 3,
  keyPrefix?: string,
): string[] {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) {
    return keyPrefix ? [`${pad}- ${keyPrefix}: null`] : [`${pad}- null`];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return keyPrefix
      ? [`${pad}- ${keyPrefix}: ${String(value)}`]
      : [`${pad}- ${String(value)}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return keyPrefix ? [`${pad}- ${keyPrefix}: []`] : [`${pad}- []`];
    }
    const header = keyPrefix ? [`${pad}- ${keyPrefix}:`] : [];
    if (indent >= maxDepth) {
      return [...header, `${pad}  - (${value.length} items)`];
    }
    const items = value.slice(0, 8).flatMap((item) =>
      renderKeyValueLines(item, indent + 1, maxDepth),
    );
    return [...header, ...items];
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const header = keyPrefix ? [`${pad}- ${keyPrefix}:`] : [];
    if (keys.length === 0) {
      return [...header, `${pad}  - {}`];
    }
    if (indent >= maxDepth) {
      return [...header, `${pad}  - (${keys.length} fields)`];
    }
    const lines = keys.flatMap((key) =>
      renderKeyValueLines(record[key], indent + 1, maxDepth, key),
    );
    return [...header, ...lines];
  }

  return keyPrefix
    ? [`${pad}- ${keyPrefix}: ${String(value)}`]
    : [`${pad}- ${String(value)}`];
}

function renderExplainMarkdown(report: ReturnType<typeof decodeExplainReport>): string {
  const lines: string[] = [];
  lines.push("# gRPCTestify Explain");
  lines.push("");

  if (report.summary && Object.keys(report.summary).length > 0) {
    lines.push("## Summary");
    lines.push(...renderKeyValueLines(report.summary));
  }

  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("");
    lines.push("## Diagnostics");
    for (const diagnostic of report.diagnostics.slice(0, 10)) {
      lines.push(
        `- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`,
      );
    }
  }

  if (report.details && Object.keys(report.details).length > 0) {
    lines.push("");
    lines.push("## Details");
    lines.push(...renderKeyValueLines(report.details));
  }

  lines.push("");
  lines.push("## Raw JSON");
  lines.push("```json");
  lines.push(JSON.stringify(report, null, 2));
  lines.push("```");
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
        const content = renderExplainMarkdown(report);
        const doc = await vscode.workspace.openTextDocument({
          language: "markdown",
          content,
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Explain failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
