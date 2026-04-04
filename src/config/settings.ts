import * as vscode from "vscode";

export const EXTENSION_ID = "grpctestify";

export const settingKeys = {
  binaryPath: "grpctestify.binary.path",
  lspEnabled: "grpctestify.lsp.enabled",
  testingAutoDiscover: "grpctestify.testing.autoDiscover",
  testingDebugMode: "grpctestify.testing.debugMode",
  testingNativeDebugBridge: "grpctestify.testing.nativeDebugBridge",
  defaultArgsRun: "grpctestify.defaultArgs.run",
  defaultArgsCheck: "grpctestify.defaultArgs.check",
  formatOnSave: "grpctestify.formatOnSave",
} as const;

export type TestingDebugMode = "stream" | "native";

export interface ExtensionSettings {
  binaryPath: string;
  lspEnabled: boolean;
  testingAutoDiscover: boolean;
  testingDebugMode: TestingDebugMode;
  testingNativeDebugBridge: boolean;
  defaultArgsRun: string[];
  defaultArgsCheck: string[];
  formatOnSave: boolean;
}

const defaultSettings: ExtensionSettings = {
  binaryPath: "grpctestify",
  lspEnabled: true,
  testingAutoDiscover: true,
  testingDebugMode: "stream",
  testingNativeDebugBridge: false,
  defaultArgsRun: [],
  defaultArgsCheck: [],
  formatOnSave: false,
};

export function getSettings(): ExtensionSettings {
  const configuration = vscode.workspace.getConfiguration();
  const debugMode = configuration.get<TestingDebugMode>(
    settingKeys.testingDebugMode,
    defaultSettings.testingDebugMode,
  );

  return {
    binaryPath: configuration.get<string>(
      settingKeys.binaryPath,
      defaultSettings.binaryPath,
    ),
    lspEnabled: configuration.get<boolean>(
      settingKeys.lspEnabled,
      defaultSettings.lspEnabled,
    ),
    testingAutoDiscover: configuration.get<boolean>(
      settingKeys.testingAutoDiscover,
      defaultSettings.testingAutoDiscover,
    ),
    testingDebugMode: debugMode === "native" ? "native" : "stream",
    testingNativeDebugBridge: configuration.get<boolean>(
      settingKeys.testingNativeDebugBridge,
      defaultSettings.testingNativeDebugBridge,
    ),
    defaultArgsRun: configuration.get<string[]>(
      settingKeys.defaultArgsRun,
      defaultSettings.defaultArgsRun,
    ),
    defaultArgsCheck: configuration.get<string[]>(
      settingKeys.defaultArgsCheck,
      defaultSettings.defaultArgsCheck,
    ),
    formatOnSave: configuration.get<boolean>(
      settingKeys.formatOnSave,
      defaultSettings.formatOnSave,
    ),
  };
}
