export interface IntegrationStatus {
  ok: boolean;
  error?: string;
}

export interface ActivationDiagnosticsSnapshot {
  integrations: Record<string, IntegrationStatus>;
  lsp: {
    hasClient: boolean;
    running: boolean;
    consecutiveFailures: number;
    restarting: boolean;
    stopping: boolean;
    lastStartedAt?: string;
  };
  testing: {
    controllerRegistered: boolean;
    lastRefreshDiscoveredItems: number;
    lastRefreshDiscoveredFiles: string[];
    lastRunMode?: "run" | "debug" | "coverage";
    lastRunCandidates: number;
    lastRunEvents: {
      started: number;
      passed: number;
      failed: number;
      skipped: number;
    };
  };
  binary?: {
    version: string;
    resolvedPath: string;
    meetsMinVersion: boolean;
    minRequired: string;
  };
}
