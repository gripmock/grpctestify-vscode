import type * as vscode from "vscode";

import { registerTestingController } from "./controller";

export function registerTesting(context: vscode.ExtensionContext): void {
  registerTestingController(context);
}
