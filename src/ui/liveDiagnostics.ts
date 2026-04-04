import * as vscode from "vscode";

import { getSettings } from "../config/settings";
import { resolveGrpctestifyBinary } from "../runtime/binaryResolver";
import { decodeCheckReport, parseJsonContract } from "../runtime/contracts";
import { toErrorMessage } from "../runtime/errors";
import { runProcess } from "../runtime/processRunner";
import {
  clearCheckDiagnostics,
  publishCheckDiagnostics,
} from "./checkDiagnostics";
import { getDebugChannel } from "./outputChannels";

const DIAGNOSTICS_DEBOUNCE_MS = 500;

function shouldValidate(document: vscode.TextDocument): boolean {
  return (
    document.languageId === "grpctestify" && document.uri.scheme === "file"
  );
}

async function validateDocument(document: vscode.TextDocument): Promise<void> {
  if (!shouldValidate(document)) {
    return;
  }

  const debug = getDebugChannel();
  try {
    const binary = await resolveGrpctestifyBinary();
    const args = [
      "check",
      document.uri.fsPath,
      "--format",
      "json",
      ...getSettings().defaultArgsCheck,
    ];
    const result = await runProcess(binary.resolvedPath, args, {
      expectedExitCodes: [0, 1],
      timeoutMs: 30000,
    });
    const report = parseJsonContract(
      result.stdout,
      decodeCheckReport,
      "check report",
    );
    publishCheckDiagnostics(report);
  } catch (error) {
    debug.appendLine(`[diagnostics] ${toErrorMessage(error)}`);
  }
}

export function registerLiveDiagnostics(
  context: vscode.ExtensionContext,
): void {
  const timers = new Map<string, NodeJS.Timeout>();

  const schedule = (document: vscode.TextDocument): void => {
    if (!shouldValidate(document)) {
      return;
    }

    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const handle = setTimeout(() => {
      void validateDocument(document);
      timers.delete(key);
    }, DIAGNOSTICS_DEBOUNCE_MS);

    timers.set(key, handle);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      schedule(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      schedule(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      schedule(event.document);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        schedule(editor.document);
      }
    }),
  );

  context.subscriptions.push(
    new vscode.Disposable(() => {
      for (const handle of timers.values()) {
        clearTimeout(handle);
      }
      timers.clear();
      clearCheckDiagnostics();
    }),
  );
}
