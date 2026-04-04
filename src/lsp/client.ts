import * as vscode from "vscode";

import { getSettings } from "../config/settings";
import { resolveGrpctestifyBinary } from "../runtime/binaryResolver";
import { toErrorMessage } from "../runtime/errors";
import { getDebugChannel, getOutputChannel } from "../ui/outputChannels";

interface LanguageClientModule {
  LanguageClient: new (
    id: string,
    name: string,
    serverOptions: { command: string; args: string[] },
    clientOptions: {
      documentSelector: Array<{ language: string; scheme: string }>;
      outputChannel: vscode.OutputChannel;
    },
  ) => {
    onDidChangeState: (callback: (event: { oldState: number; newState: number }) => void) => void;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    isRunning: () => boolean;
  };
  State: {
    Running: number;
    Stopped: number;
  };
}

async function loadLanguageClientModule(): Promise<LanguageClientModule> {
  const candidates = [
    "vscode-languageclient/node",
    "vscode-languageclient/node.js",
    "vscode-languageclient/lib/node/main",
  ];

  for (const candidate of candidates) {
    try {
      const loaded = (await import(candidate)) as {
        default?: unknown;
        LanguageClient?: unknown;
        State?: unknown;
      };
      const moduleLike =
        loaded.LanguageClient && loaded.State
          ? loaded
          : (loaded.default as LanguageClientModule | undefined);
      if (moduleLike?.LanguageClient && moduleLike?.State) {
        return moduleLike as LanguageClientModule;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    "Unable to load vscode-languageclient (tried node, node.js, lib/node/main)",
  );
}

export class GrpctestifyLspClient {
  private client:
    | {
        onDidChangeState: (
          callback: (event: { oldState: number; newState: number }) => void,
        ) => void;
        start: () => Promise<void>;
        stop: () => Promise<void>;
        isRunning: () => boolean;
      }
    | undefined;
  private consecutiveFailures = 0;
  private stopping = false;
  private restarting = false;
  private lastStartedAt: string | undefined;

  getDebugState(): {
    hasClient: boolean;
    running: boolean;
    consecutiveFailures: number;
    restarting: boolean;
    stopping: boolean;
    lastStartedAt?: string;
  } {
    return {
      hasClient: Boolean(this.client),
      running: this.client?.isRunning() ?? false,
      consecutiveFailures: this.consecutiveFailures,
      restarting: this.restarting,
      stopping: this.stopping,
      lastStartedAt: this.lastStartedAt,
    };
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    const settings = getSettings();
    if (!settings.lspEnabled) {
      return;
    }

    const output = getOutputChannel();
    const debug = getDebugChannel();

    try {
      const binary = await resolveGrpctestifyBinary();
      const languageClient = await loadLanguageClientModule();

      const serverOptions = {
        command: binary.resolvedPath,
        args: ["lsp", "--stdio"],
        options: {
          env: {
            ...process.env,
            GRPCTESTIFY_ADDRESS:
              process.env.GRPCTESTIFY_ADDRESS ?? "localhost:4770",
          },
        },
      };

      const clientOptions = {
        documentSelector: [{ language: "grpctestify", scheme: "file" }],
        outputChannel: output,
      };

      this.client = new languageClient.LanguageClient(
        "grpctestify-lsp",
        "gRPCTestify Language Server",
        serverOptions,
        clientOptions,
      );

      this.client.onDidChangeState((event) => {
        if (
          event.oldState === languageClient.State.Running &&
          event.newState === languageClient.State.Stopped
        ) {
          void this.scheduleRestartWithBackoff();
        }
      });

      await this.client.start();
      this.consecutiveFailures = 0;
      this.lastStartedAt = new Date().toISOString();
      debug.appendLine("[lsp] started");
    } catch (error) {
      this.client = undefined;
      this.consecutiveFailures += 1;
      const message = `Failed to start gRPCTestify LSP: ${toErrorMessage(error)}`;
      output.appendLine(message);
      debug.appendLine(`[lsp:error] ${message}`);
      if (this.consecutiveFailures >= 3) {
        void vscode.window.showWarningMessage(
          `${message}. LSP is in degraded mode after repeated failures. Use gRPCTestify: Restart LSP after fixing binary/runtime issues.`,
        );
      } else {
        void vscode.window.showWarningMessage(message);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.client) {
      return;
    }

    const debug = getDebugChannel();
    this.stopping = true;
    await this.client.stop();
    this.client = undefined;
    this.stopping = false;
    debug.appendLine("[lsp] stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async scheduleRestartWithBackoff(): Promise<void> {
    if (this.stopping || this.restarting) {
      return;
    }

    const debug = getDebugChannel();
    const output = getOutputChannel();

    this.restarting = true;
    this.client = undefined;
    this.consecutiveFailures += 1;

    const delayMs = Math.min(
      30000,
      1000 * Math.pow(2, Math.max(0, this.consecutiveFailures - 1)),
    );
    debug.appendLine(
      `[lsp] restarting after ${delayMs}ms (failure #${this.consecutiveFailures})`,
    );

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await this.start();

    if (this.consecutiveFailures >= 3) {
      output.appendLine("LSP degraded mode active due to repeated failures.");
    }

    this.restarting = false;
  }
}
