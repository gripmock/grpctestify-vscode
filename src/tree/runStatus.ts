import * as vscode from "vscode";

export type RunStatus = "unknown" | "running" | "passed" | "failed";

const statusByFile = new Map<string, RunStatus>();
const emitter = new vscode.EventEmitter<void>();

export const onDidChangeRunStatus = emitter.event;

export function getRunStatus(filePath: string): RunStatus {
  return statusByFile.get(filePath) ?? "unknown";
}

export function setRunStatus(filePath: string, status: RunStatus): void {
  statusByFile.set(filePath, status);
  emitter.fire();
}
