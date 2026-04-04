import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;
let debugChannel: vscode.OutputChannel | undefined;

export function initializeOutputChannels(
  context: vscode.ExtensionContext,
): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("gRPCTestify");
    context.subscriptions.push(outputChannel);
  }
  if (!debugChannel) {
    debugChannel = vscode.window.createOutputChannel("gRPCTestify Debug");
    context.subscriptions.push(debugChannel);
  }
}

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("gRPCTestify");
  }
  return outputChannel;
}

export function getDebugChannel(): vscode.OutputChannel {
  if (!debugChannel) {
    debugChannel = vscode.window.createOutputChannel("gRPCTestify Debug");
  }
  return debugChannel;
}
