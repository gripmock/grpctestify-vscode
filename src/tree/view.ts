import * as path from "node:path";
import * as vscode from "vscode";

import { runTarget } from "../commands/run";
import { getRunStatus, onDidChangeRunStatus } from "./runStatus";

export const TREE_VIEW_ID = "grpctestifyExplorer";
const TREE_REFRESH_COMMAND_ID = "grpctestify.tree.refresh";
const TREE_RUN_COMMAND_ID = "grpctestify.tree.runItem";
const TREE_EXPLAIN_COMMAND_ID = "grpctestify.tree.explainItem";
const TREE_INSPECT_COMMAND_ID = "grpctestify.tree.inspectItem";

class GctfTreeItem extends vscode.TreeItem {
  readonly filePath: string;

  constructor(filePath: string) {
    const status = getRunStatus(filePath);
    const label = path.basename(filePath);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.filePath = filePath;
    this.description = `last run: ${status}`;
    this.tooltip = `${filePath}\nLast run: ${status}`;
    this.resourceUri = vscode.Uri.file(filePath);
    this.contextValue = "gctfFile";
    this.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [vscode.Uri.file(filePath)],
    };
  }
}

class GrpctestifyTreeProvider implements vscode.TreeDataProvider<GctfTreeItem> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  refresh(): void {
    this.onDidChangeEmitter.fire();
  }

  getTreeItem(element: GctfTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<GctfTreeItem[]> {
    const files = await vscode.workspace.findFiles("**/*.gctf");
    return files
      .map((uri) => new GctfTreeItem(uri.fsPath))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }
}

export function registerTreeView(context: vscode.ExtensionContext): void {
  const provider = new GrpctestifyTreeProvider();

  context.subscriptions.push(
    vscode.window.createTreeView(TREE_VIEW_ID, {
      treeDataProvider: provider,
      showCollapseAll: true,
    }),
  );

  context.subscriptions.push(onDidChangeRunStatus(() => provider.refresh()));

  context.subscriptions.push(
    vscode.commands.registerCommand(TREE_REFRESH_COMMAND_ID, () => {
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      TREE_RUN_COMMAND_ID,
      async (item: GctfTreeItem) => {
        await runTarget(
          item.filePath,
          `gRPCTestify: Run ${path.basename(item.filePath)}`,
        );
        provider.refresh();
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      TREE_EXPLAIN_COMMAND_ID,
      async (item: GctfTreeItem) => {
        await vscode.window.showTextDocument(vscode.Uri.file(item.filePath), {
          preview: false,
        });
        await vscode.commands.executeCommand("grpctestify.explain");
        provider.refresh();
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      TREE_INSPECT_COMMAND_ID,
      async (item: GctfTreeItem) => {
        await vscode.window.showTextDocument(vscode.Uri.file(item.filePath), {
          preview: false,
        });
        await vscode.commands.executeCommand("grpctestify.inspect");
        provider.refresh();
      },
    ),
  );
}
