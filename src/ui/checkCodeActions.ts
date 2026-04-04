import * as vscode from "vscode";

import { getQuickFixForDiagnostic } from "./checkDiagnostics";

function toRange(range: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}): vscode.Range {
  return new vscode.Range(
    new vscode.Position(
      Math.max(0, range.start.line - 1),
      Math.max(0, range.start.column - 1),
    ),
    new vscode.Position(
      Math.max(0, range.end.line - 1),
      Math.max(0, range.end.column - 1),
    ),
  );
}

export function registerCheckCodeActions(
  context: vscode.ExtensionContext,
): void {
  const provider = vscode.languages.registerCodeActionsProvider(
    "grpctestify",
    {
      provideCodeActions(document, _, contextData) {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of contextData.diagnostics) {
          const quickFix = getQuickFixForDiagnostic(document.uri, diagnostic);
          if (!quickFix) {
            continue;
          }

          const action = new vscode.CodeAction(
            quickFix.title,
            vscode.CodeActionKind.QuickFix,
          );
          action.isPreferred = true;
          action.diagnostics = [diagnostic];
          action.edit = new vscode.WorkspaceEdit();

          for (const edit of quickFix.edits) {
            action.edit.replace(
              document.uri,
              toRange(edit.range),
              edit.new_text,
            );
          }

          actions.push(action);
        }

        return actions;
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    },
  );

  context.subscriptions.push(provider);
}
