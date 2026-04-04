import type * as vscode from "vscode";

import { registerTreeView } from "./view";

export function registerTree(context: vscode.ExtensionContext): void {
  registerTreeView(context);
}
