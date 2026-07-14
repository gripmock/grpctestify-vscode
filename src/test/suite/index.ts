import * as path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Mocha = require("mocha");
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 20000,
  });

  const testsRoot = path.resolve(__dirname, ".");
  mocha.addFile(path.resolve(testsRoot, "extension.test.js"));

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
        return;
      }
      resolve();
    });
  });

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}
