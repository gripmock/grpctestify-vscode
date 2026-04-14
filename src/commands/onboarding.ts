import * as vscode from "vscode";

export const OPEN_SAMPLE_COMMAND_ID = "grpctestify.openSample";
export const FOCUS_TESTING_COMMAND_ID = "grpctestify.focusTesting";

const SAMPLE_GCTF = [
  "--- ADDRESS ---",
  "localhost:4770",
  "",
  "--- ENDPOINT ---",
  "helloworld.Greeter/SayHello",
  "",
  "--- REQUEST ---",
  "{",
  '  "name": "Walkthrough"',
  "}",
  "",
  "--- RESPONSE with_asserts ---",
  "{",
  '  "message": "Hello Walkthrough"',
  "}",
  "",
  "--- ASSERTS ---",
  '.message startsWith "Hello"',
].join("\n");

export function registerOnboardingCommands(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_SAMPLE_COMMAND_ID, async () => {
      const document = await vscode.workspace.openTextDocument({
        language: "grpctestify",
        content: SAMPLE_GCTF,
      });
      await vscode.window.showTextDocument(document, { preview: false });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(FOCUS_TESTING_COMMAND_ID, async () => {
      await vscode.commands.executeCommand("workbench.view.testing.focus");
    }),
  );
}
