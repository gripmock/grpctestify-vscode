import type * as vscode from "vscode";
import type { ActivationDiagnosticsSnapshot } from "../runtime/activationDiagnostics";

import { registerCheckCommand } from "./check";
import { registerExplainCommand } from "./explain";
import { registerFmtCommand } from "./fmt";
import { registerHealthCommand } from "./health";
import { registerInspectCommand } from "./inspect";
import { registerOnboardingCommands } from "./onboarding";
import { registerReflectCommand } from "./reflect";
import { registerRestartLspCommand } from "./restartLsp";
import { registerCallCommand } from "./call";
import { registerPlayCommand } from "./play";
import { registerRunCommand } from "./run";

export interface CommandDependencies {
  restartLsp: () => Promise<void>;
  getActivationDiagnostics: () => Promise<ActivationDiagnosticsSnapshot>;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
): void {
  registerRunCommand(context);
  registerCallCommand(context);
  registerPlayCommand(context);
  registerCheckCommand(context);
  registerFmtCommand(context);
  registerInspectCommand(context);
  registerExplainCommand(context);
  registerReflectCommand(context);
  registerRestartLspCommand(context, dependencies.restartLsp);
  registerHealthCommand(context, dependencies.getActivationDiagnostics);
  registerOnboardingCommands(context);
}
