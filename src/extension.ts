import * as vscode from "vscode";
import { registerCommands } from "./commands";
import type { ActivationDiagnosticsSnapshot } from "./runtime/activationDiagnostics";
import {
  MIN_CLI_VERSION,
  resolveGrpctestifyBinary,
} from "./runtime/binaryResolver";
import { GrpctestifyError, toErrorMessage } from "./runtime/errors";
import { registerStatus } from "./status";
import { registerTasks } from "./tasks";
import { registerTesting } from "./testing";
import { getTestingControllerDebugState } from "./testing/controller";
import { registerTree } from "./tree";
import { registerCodeLens } from "./ui/codeLens";
import { registerCheckCodeActions } from "./ui/checkCodeActions";
import { initializeCheckDiagnostics } from "./ui/checkDiagnostics";
import { registerCompletionProvider } from "./ui/completionProvider";
import { registerDocumentLinks } from "./ui/documentLinks";
import { registerFormatting } from "./ui/formatProvider";
import { registerHoverProvider } from "./ui/hoverProvider";
import { registerLiveDiagnostics } from "./ui/liveDiagnostics";
import { getDebugChannel, initializeOutputChannels } from "./ui/outputChannels";

interface LspDebugState {
  hasClient: boolean;
  running: boolean;
  consecutiveFailures: number;
  restarting: boolean;
  stopping: boolean;
  lastStartedAt?: string;
}

interface LspClientAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getDebugState(): LspDebugState;
}

let lspClient: LspClientAdapter | undefined;

let hasShownBinaryMissingWarning = false;
let hasShownVersionWarning = false;
const integrationStatuses: Record<string, { ok: boolean; error?: string }> = {};

function markIntegrationOk(name: string): void {
  integrationStatuses[name] = { ok: true };
}

function markIntegrationError(name: string, error: unknown): void {
  integrationStatuses[name] = { ok: false, error: toErrorMessage(error) };
}

function registerOptionalIntegration(name: string, action: () => void): void {
  try {
    action();
    markIntegrationOk(name);
  } catch (error) {
    markIntegrationError(name, error);
  }
}

async function showBinaryOnboardingIfNeeded(): Promise<void> {
  try {
    const binary = await resolveGrpctestifyBinary();
    if (!binary.meetsMinVersion && !hasShownVersionWarning) {
      hasShownVersionWarning = true;
      void vscode.window.showWarningMessage(
        `gRPCTestify CLI v${binary.version} is below the recommended v${MIN_CLI_VERSION}. Some extension features may not work. Please update grpctestify-rust.`,
      );
    }
  } catch (error) {
    if (hasShownBinaryMissingWarning) {
      return;
    }
    hasShownBinaryMissingWarning = true;

    if (
      error instanceof GrpctestifyError &&
      error.code === "BINARY_NOT_FOUND"
    ) {
      // Binary not found — logged in onboarding flow, no popup spam
      return;
    }

    const debug = getDebugChannel?.();
    if (debug) {
      debug.appendLine(`[startup] ${toErrorMessage(error)}`);
    }
  }
}

async function createLspClient(): Promise<LspClientAdapter | undefined> {
  try {
    const lspModule = await import("./lsp/client");
    return new lspModule.GrpctestifyLspClient();
  } catch (error) {
    markIntegrationError("lsp", error);
    const debug = getDebugChannel();
    if (debug) {
      debug.appendLine(`[lsp:module] ${toErrorMessage(error)}`);
    }
    return undefined;
  }
}

async function startLspInBackground(client: LspClientAdapter): Promise<void> {
  try {
    await client.start();
    if (client.getDebugState().hasClient) {
      markIntegrationOk("lsp");
      return;
    }

    integrationStatuses.lsp = {
      ok: false,
      error: "LSP client is not running",
    };
  } catch (error) {
    markIntegrationError("lsp", error);
    const debug = getDebugChannel();
    if (debug) {
      debug.appendLine(`[lsp:start] ${toErrorMessage(error)}`);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  initializeOutputChannels(context);
  markIntegrationOk("outputChannels");
  registerCommands(context, {
    restartLsp: async () => {
      if (!lspClient) {
        void vscode.window.showWarningMessage(
          "gRPCTestify LSP is unavailable in this session. Run/Check/Format commands still work.",
        );
        return;
      }
      await lspClient.restart();
    },
    getActivationDiagnostics:
      async (): Promise<ActivationDiagnosticsSnapshot> => {
        let binaryInfo: ActivationDiagnosticsSnapshot["binary"];
        try {
          const binary = await resolveGrpctestifyBinary();
          binaryInfo = {
            version: binary.version,
            resolvedPath: binary.resolvedPath,
            meetsMinVersion: binary.meetsMinVersion,
            minRequired: MIN_CLI_VERSION,
          };
        } catch {
          binaryInfo = undefined;
        }
        return {
          integrations: { ...integrationStatuses },
          lsp: lspClient
            ? lspClient.getDebugState()
            : {
                hasClient: false,
                running: false,
                consecutiveFailures: 0,
                restarting: false,
                stopping: false,
              },
          testing: getTestingControllerDebugState(),
          binary: binaryInfo,
        };
      },
  });
  markIntegrationOk("commands");

  registerOptionalIntegration("tree", () => registerTree(context));
  registerOptionalIntegration("testing", () => registerTesting(context));
  registerOptionalIntegration("status", () => registerStatus(context));
  registerOptionalIntegration("tasks", () => registerTasks(context));
  registerOptionalIntegration("formatting", () => registerFormatting(context));
  registerOptionalIntegration("codeLens", () => registerCodeLens(context));
  registerOptionalIntegration("hover", () => registerHoverProvider(context));
  registerOptionalIntegration("documentLinks", () =>
    registerDocumentLinks(context),
  );
  registerOptionalIntegration("checkDiagnostics", () =>
    initializeCheckDiagnostics(context),
  );
  registerOptionalIntegration("liveDiagnostics", () =>
    registerLiveDiagnostics(context),
  );
  registerOptionalIntegration("checkCodeActions", () =>
    registerCheckCodeActions(context),
  );
  registerOptionalIntegration("completion", () =>
    registerCompletionProvider(context, {
      isLspRunning: () => lspClient?.getDebugState().running ?? false,
    }),
  );

  void showBinaryOnboardingIfNeeded();

  void createLspClient().then((client) => {
    lspClient = client;
    if (!lspClient) {
      integrationStatuses.lsp = {
        ok: false,
        error: "LSP module is unavailable",
      };
      return;
    }

    void startLspInBackground(lspClient);
  });

  if (!lspClient) {
    integrationStatuses.lsp = {
      ok: false,
      error: "LSP startup pending",
    };
  }
}

export async function deactivate(): Promise<void> {
  if (lspClient) {
    await lspClient.stop();
    lspClient = undefined;
  }
}
