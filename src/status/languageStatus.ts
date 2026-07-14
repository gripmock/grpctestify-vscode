import * as vscode from "vscode";

import {
  MIN_CLI_VERSION,
  resolveGrpctestifyBinary,
} from "../runtime/binaryResolver";
import { GrpctestifyError } from "../runtime/errors";
import { isLspDegraded, onDidChangeLspDegraded } from "../runtime/lspEvents";
import { isLiveDiagDegraded, onDidChangeLiveDiagDegraded } from "../ui/liveDiagnostics";

export function registerLanguageStatus(context: vscode.ExtensionContext): void {
  const item = vscode.languages.createLanguageStatusItem(
    "grpctestify.languageStatus",
    { language: "grpctestify" },
  );
  item.name = "gRPCTestify";

  const refresh = async () => {
    try {
      const binary = await resolveGrpctestifyBinary();
      if (isLspDegraded || isLiveDiagDegraded) {
        const parts: string[] = [];
        if (isLspDegraded) parts.push("LSP");
        if (isLiveDiagDegraded) parts.push("diag");
        item.text = `$(warning) ${parts.join("/")} degraded`;
        item.detail = "gRPCTestify";
        item.severity = vscode.LanguageStatusSeverity.Warning;
        item.command = { command: "grpctestify.health", title: "Health Check" };
      } else if (binary.meetsMinVersion) {
        item.text = `$(check) v${binary.version}`;
        item.detail = "gRPCTestify ready";
        item.severity = vscode.LanguageStatusSeverity.Information;
        item.command = undefined;
      } else {
        item.text = `$(warning) v${binary.version}`;
        item.detail = `Update recommended (>= ${MIN_CLI_VERSION})`;
        item.severity = vscode.LanguageStatusSeverity.Warning;
        item.command = { command: "grpctestify.health", title: "Update" };
      }
    } catch (error) {
      if (
        error instanceof GrpctestifyError &&
        error.code === "BINARY_NOT_FOUND"
      ) {
        item.text = "$(error) binary missing";
        item.detail = "grpctestify not found";
      } else {
        item.text = "$(warning) degraded";
        item.detail = "gRPCTestify error";
      }
      item.severity = vscode.LanguageStatusSeverity.Error;
      item.command = { command: "grpctestify.health", title: "Health Check" };
    }
  };

  context.subscriptions.push(item);

  context.subscriptions.push(
    onDidChangeLspDegraded.event(() => void refresh()),
  );
  context.subscriptions.push(
    onDidChangeLiveDiagDegraded.event(() => void refresh()),
  );

  void refresh();
}
