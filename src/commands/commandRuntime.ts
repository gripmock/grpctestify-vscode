import * as vscode from "vscode";

import { getSettings } from "../config/settings";
import { resolveGrpctestifyBinary } from "../runtime/binaryResolver";
import type { ProcessResult } from "../runtime/processRunner";
import { runProcess } from "../runtime/processRunner";
import { toErrorMessage } from "../runtime/errors";
import { getDebugChannel, getOutputChannel } from "../ui/outputChannels";

let lastCliExecutionLog: string[] = [];

export function getLastCliExecutionLog(): string[] {
  return [...lastCliExecutionLog];
}

function selectedWorkspacePath(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    if (folder) {
      return folder.uri.fsPath;
    }
  }

  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getActiveGctfFilePath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  return editor.document.uri.fsPath;
}

export function getDefaultRunTargetPath(): string | undefined {
  return getActiveGctfFilePath() ?? selectedWorkspacePath();
}

export async function executeCliCommand(
  args: string[],
  options: {
    title: string;
    expectedExitCodes?: number[];
    timeoutMs?: number;
    cancellationToken?: vscode.CancellationToken;
  },
): Promise<ProcessResult> {
  const output = getOutputChannel();
  const debug = getDebugChannel();

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.title,
      cancellable: true,
    },
    async (_, token) => {
      const linkedController = new AbortController();
      const cancellationToken = options.cancellationToken ?? token;
      cancellationToken.onCancellationRequested(() => linkedController.abort());

      const binary = await resolveGrpctestifyBinary();
      const fullArgs = [...args];
      lastCliExecutionLog = [];

      const logLine = (line: string) => {
        lastCliExecutionLog.push(line);
      };

      output.appendLine(`$ ${binary.resolvedPath} ${fullArgs.join(" ")}`);
      debug.appendLine(`[exec] ${binary.resolvedPath} ${fullArgs.join(" ")}`);
      logLine(`$ ${binary.resolvedPath} ${fullArgs.join(" ")}`);

      try {
        const result = await runProcess(binary.resolvedPath, fullArgs, {
          expectedExitCodes: options.expectedExitCodes,
          timeoutMs: options.timeoutMs ?? 60000,
          signal: linkedController.signal,
          onStdoutLine: (line) => debug.appendLine(`[stdout] ${line}`),
          onStderrLine: (line) => debug.appendLine(`[stderr] ${line}`),
        });

        if (result.stdout.trim().length > 0) {
          output.appendLine(result.stdout.trim());
          logLine(result.stdout.trim());
        }
        if (result.stderr.trim().length > 0) {
          output.appendLine(result.stderr.trim());
          logLine(result.stderr.trim());
        }

        return result;
      } catch (error) {
        const message = toErrorMessage(error);
        output.appendLine(message);
        debug.appendLine(`[error] ${message}`);
        logLine(message);
        throw error;
      }
    },
  );
}

export function runArgsWithDefaults(extraArgs: string[]): string[] {
  const settings = getSettings();
  return ["run", ...settings.defaultArgsRun, ...extraArgs];
}

export function checkArgsWithDefaults(extraArgs: string[]): string[] {
  const settings = getSettings();
  return ["check", ...settings.defaultArgsCheck, ...extraArgs];
}
