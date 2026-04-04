import type * as vscode from "vscode";

import { registerTaskProvider } from "./provider";

export function registerTasks(context: vscode.ExtensionContext): void {
  registerTaskProvider(context);
}
