import type * as vscode from "vscode";

import { registerStatusBar } from "./statusBar";

export function registerStatus(context: vscode.ExtensionContext): void {
  registerStatusBar(context);
}
