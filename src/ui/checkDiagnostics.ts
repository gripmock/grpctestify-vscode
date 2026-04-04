import * as path from "node:path";
import * as vscode from "vscode";

import type { CheckDiagnostic, CheckReport } from "../runtime/contracts";

let diagnosticCollection: vscode.DiagnosticCollection | undefined;
const quickFixRegistry = new Map<
  string,
  NonNullable<CheckDiagnostic["quick_fix"]>
>();

function quickFixKey(uri: vscode.Uri, diagnostic: vscode.Diagnostic): string {
  return [
    uri.toString(),
    diagnostic.range.start.line,
    diagnostic.range.start.character,
    diagnostic.range.end.line,
    diagnostic.range.end.character,
    String(diagnostic.code ?? ""),
    diagnostic.message,
  ].join("|");
}

function severityToVsCode(
  severity: CheckDiagnostic["severity"],
): vscode.DiagnosticSeverity {
  switch (severity) {
    case "Error":
      return vscode.DiagnosticSeverity.Error;
    case "Warning":
      return vscode.DiagnosticSeverity.Warning;
    case "Info":
      return vscode.DiagnosticSeverity.Information;
    case "Hint":
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

function toRange(range: CheckDiagnostic["range"]): vscode.Range {
  return new vscode.Range(
    new vscode.Position(
      Math.max(range.start.line - 1, 0),
      Math.max(range.start.column - 1, 0),
    ),
    new vscode.Position(
      Math.max(range.end.line - 1, 0),
      Math.max(range.end.column - 1, 0),
    ),
  );
}

function toUri(file: string): vscode.Uri {
  if (file.startsWith("file://")) {
    return vscode.Uri.parse(file);
  }
  return vscode.Uri.file(path.resolve(file));
}

export function initializeCheckDiagnostics(
  context: vscode.ExtensionContext,
): void {
  const collection = ensureDiagnosticCollection();
  context.subscriptions.push(collection);
}

export function clearCheckDiagnostics(): void {
  diagnosticCollection?.clear();
  quickFixRegistry.clear();
}

export function getQuickFixForDiagnostic(
  uri: vscode.Uri,
  diagnostic: vscode.Diagnostic,
): NonNullable<CheckDiagnostic["quick_fix"]> | undefined {
  return quickFixRegistry.get(quickFixKey(uri, diagnostic));
}

export function publishCheckDiagnostics(report: CheckReport): void {
  const collection = ensureDiagnosticCollection();

  const grouped = new Map<string, vscode.Diagnostic[]>();
  for (const item of report.diagnostics) {
    const key = toUri(item.file).toString();
    const list = grouped.get(key) ?? [];
    const diagnostic = new vscode.Diagnostic(
      toRange(item.range),
      item.message,
      severityToVsCode(item.severity),
    );
    diagnostic.source = "grpctestify-check";
    diagnostic.code = item.code;
    if (item.hint) {
      diagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(toUri(item.file), toRange(item.range)),
          `hint: ${item.hint}`,
        ),
      ];
    }
    list.push(diagnostic);
    grouped.set(key, list);
  }

  collection.clear();
  quickFixRegistry.clear();

  for (const [uri, diagnostics] of grouped) {
    const parsedUri = vscode.Uri.parse(uri);
    collection.set(parsedUri, diagnostics);
    for (const diagnostic of diagnostics) {
      const sourceItem = report.diagnostics.find((item) => {
        const itemUri = toUri(item.file).toString();
        return (
          itemUri === parsedUri.toString() &&
          item.message === diagnostic.message &&
          item.code === diagnostic.code
        );
      });

      if (sourceItem?.quick_fix) {
        quickFixRegistry.set(
          quickFixKey(parsedUri, diagnostic),
          sourceItem.quick_fix,
        );
      }
    }
  }
}
function ensureDiagnosticCollection(): vscode.DiagnosticCollection {
  if (!diagnosticCollection) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection(
      "grpctestify-check",
    );
  }
  return diagnosticCollection;
}
