import * as vscode from "vscode";

export type RunStatus = "unknown" | "running" | "passed" | "failed";

const MAX_ENTRIES = 1000;
const statusByFile = new Map<string, RunStatus>();
const emitter = new vscode.EventEmitter<void>();

export const onDidChangeRunStatus = emitter.event;

export function getRunStatus(filePath: string): RunStatus {
  const value = statusByFile.get(filePath);
  if (value === undefined) return "unknown";
  statusByFile.delete(filePath);
  statusByFile.set(filePath, value);
  return value;
}

export function setRunStatus(filePath: string, status: RunStatus): void {
  statusByFile.delete(filePath);
  statusByFile.set(filePath, status);
  while (statusByFile.size > MAX_ENTRIES) {
    const oldest = statusByFile.keys().next().value;
    if (oldest !== undefined) statusByFile.delete(oldest);
  }
  emitter.fire();
}
