import * as vscode from "vscode";

import { executeCliCommand, getProtocolArgs } from "./commandRuntime";
import { toErrorMessage } from "../runtime/errors";

export const CALL_COMMAND_ID = "grpctestify.call";

export function registerCallCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    CALL_COMMAND_ID,
    async () => {
      const address = await vscode.window.showInputBox({
        title: "gRPCTestify: Call",
        prompt: "Enter gRPC server address (host:port)",
        placeHolder: "localhost:50051",
      });
      if (address === undefined) return;

      const endpoint = await vscode.window.showInputBox({
        title: "gRPCTestify: Call",
        prompt: "Enter method endpoint (package.Service/Method)",
        placeHolder: "helloworld.Greeter/SayHello",
      });
      if (endpoint === undefined) return;

      const data = await vscode.window.showInputBox({
        title: "gRPCTestify: Call (optional)",
        prompt: "Enter JSON request body (or leave empty)",
        placeHolder: '{"name": "world"}',
      });
      if (data === undefined) return;

      const args = [
        "call",
        ...getProtocolArgs(),
        "-e", endpoint,
        "--address", address,
      ];
      if (data.trim().length > 0) {
        args.push("-d", data.trim());
      }

      try {
        const result = await executeCliCommand(args, {
          title: "gRPCTestify: Call",
        });
        if (result.stdout.trim().length > 0) {
          const doc = await vscode.workspace.openTextDocument({
            language: "json",
            content: result.stdout,
          });
          await vscode.window.showTextDocument(doc, { preview: false });
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Call failed: ${toErrorMessage(error)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}
