import * as vscode from "vscode";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";

import { getSettings } from "../config/settings";
import { resolveGrpctestifyBinary } from "../runtime/binaryResolver";
import { runProcess } from "../runtime/processRunner";
import { toErrorMessage } from "../runtime/errors";
import { getDebugChannel } from "./outputChannels";

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine =
    document.lineCount > 0
      ? document.lineAt(document.lineCount - 1)
      : undefined;
  return new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(
      document.lineCount > 0 ? document.lineCount - 1 : 0,
      lastLine?.text.length ?? 0,
    ),
  );
}

export function registerFormatting(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerDocumentFormattingEditProvider(
    "grpctestify",
    {
      provideDocumentFormattingEdits: async (document) => {
        const debug = getDebugChannel();
        const documentDir = path.dirname(document.uri.fsPath);
        const tempFile = path.join(
          documentDir,
          `.grpctestify-fmt-${randomUUID()}.gctf`,
        );

        try {
          await writeFile(tempFile, document.getText(), "utf8");

          const binary = await resolveGrpctestifyBinary();
          await runProcess(binary.resolvedPath, ["fmt", tempFile, "--write"], {
            timeoutMs: 45000,
          });

          const formatted = await readFile(tempFile, "utf8");
          if (formatted === document.getText()) {
            return [];
          }

          return [
            vscode.TextEdit.replace(fullDocumentRange(document), formatted),
          ];
        } catch (error) {
          const message = `Format provider failed: ${toErrorMessage(error)}`;
          debug.appendLine(`[format] ${message}`);
          void vscode.window.showWarningMessage(message);
          return [];
        } finally {
          await rm(tempFile, { force: true });
        }
      },
    },
  );

  const onWillSave = vscode.workspace.onWillSaveTextDocument((event) => {
    if (
      event.document.languageId !== "grpctestify" ||
      !getSettings().formatOnSave
    ) {
      return;
    }

    event.waitUntil(
      vscode.commands.executeCommand<vscode.TextEdit[]>(
        "vscode.executeFormatDocumentProvider",
        event.document.uri,
      ),
    );
  });

  context.subscriptions.push(provider, onWillSave);
}
