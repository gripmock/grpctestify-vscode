import * as path from "node:path";

import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [],
    version: process.env.VSCODE_VERSION,
  });
}

main().catch((error) => {
  console.error("Failed to run extension tests");
  console.error(error);
  process.exit(1);
});
