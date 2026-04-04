import * as vscode from "vscode";

import { getSettings } from "../config/settings";

interface GrpctestifyTaskDefinition extends vscode.TaskDefinition {
  task: "run" | "check" | "fmt";
  folder: string;
}

const TASK_TYPE = "grpctestify";

function buildTask(
  folder: vscode.WorkspaceFolder,
  kind: GrpctestifyTaskDefinition["task"],
): vscode.Task {
  const settings = getSettings();
  const definition: GrpctestifyTaskDefinition = {
    type: TASK_TYPE,
    task: kind,
    folder: folder.uri.fsPath,
  };

  const args =
    kind === "run"
      ? ["run", folder.uri.fsPath, ...settings.defaultArgsRun]
      : kind === "check"
        ? ["check", folder.uri.fsPath, ...settings.defaultArgsCheck]
        : ["fmt", folder.uri.fsPath, "--write"];

  const execution = new vscode.ProcessExecution(settings.binaryPath, args, {
    cwd: folder.uri.fsPath,
  });

  const task = new vscode.Task(
    definition,
    folder,
    `grpctestify: ${kind}`,
    TASK_TYPE,
    execution,
    [kind === "check" ? "$grpctestify-check" : "$grpctestify-generic"],
  );

  if (kind === "check") {
    task.group = vscode.TaskGroup.Test;
  }

  return task;
}

export class GrpctestifyTaskProvider implements vscode.TaskProvider {
  provideTasks(): vscode.ProviderResult<vscode.Task[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const tasks: vscode.Task[] = [];
    for (const folder of folders) {
      tasks.push(buildTask(folder, "run"));
      tasks.push(buildTask(folder, "check"));
      tasks.push(buildTask(folder, "fmt"));
    }
    return tasks;
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as GrpctestifyTaskDefinition;
    if (!definition?.task || !definition.folder) {
      return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(definition.folder),
    );
    if (!folder) {
      return undefined;
    }
    return buildTask(folder, definition.task);
  }
}

export function registerTaskProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(TASK_TYPE, new GrpctestifyTaskProvider()),
  );
}
