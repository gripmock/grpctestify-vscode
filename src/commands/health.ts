import * as vscode from "vscode";

import type { ActivationDiagnosticsSnapshot } from "../runtime/activationDiagnostics";
import {
  MIN_CLI_VERSION,
  resolveGrpctestifyBinary,
} from "../runtime/binaryResolver";
import { toErrorMessage } from "../runtime/errors";

export const HEALTH_COMMAND_ID = "grpctestify.health";
export const ACTIVATION_DIAGNOSTICS_COMMAND_ID =
  "grpctestify.activationDiagnostics";

export function registerHealthCommand(
  context: vscode.ExtensionContext,
  getActivationDiagnostics: () => Promise<ActivationDiagnosticsSnapshot>,
): void {
  const healthDisposable = vscode.commands.registerCommand(
    HEALTH_COMMAND_ID,
    async () => {
      try {
        const binary = await resolveGrpctestifyBinary();
        const versionStatus = binary.meetsMinVersion
          ? "OK"
          : `BELOW MINIMUM (>= ${MIN_CLI_VERSION} required)`;
        const message = [
          `Binary: ${binary.resolvedPath}`,
          `Version: ${binary.version} (${versionStatus})`,
          `Capabilities: ${Object.entries(binary.capabilities)
            .filter(([, enabled]) => enabled)
            .map(([name]) => name)
            .join(", ")}`,
        ].join("\n");

        if (binary.meetsMinVersion) {
          void vscode.window.showInformationMessage(
            `gRPCTestify health check OK\n${message}`,
          );
        } else {
          void vscode.window.showWarningMessage(
            `gRPCTestify health check: version warning\n${message}`,
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `gRPCTestify health check failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  const activationDiagnosticsDisposable = vscode.commands.registerCommand(
    ACTIVATION_DIAGNOSTICS_COMMAND_ID,
    async () => {
      try {
        const grpctestifyCommands = (await vscode.commands.getCommands(true))
          .filter((command) => command.startsWith("grpctestify."))
          .sort();
        const diagnostics = await getActivationDiagnostics();
        const payload = {
          commands: grpctestifyCommands,
          ...diagnostics,
        };
        void vscode.window.showInformationMessage(
          `gRPCTestify activation diagnostics collected (${grpctestifyCommands.length} commands).`,
        );
        return payload;
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Activation diagnostics failed: ${toErrorMessage(error)}`,
        );
        throw error;
      }
    },
  );

  context.subscriptions.push(healthDisposable, activationDiagnosticsDisposable);
}
