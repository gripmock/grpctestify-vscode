import * as vscode from "vscode";

function command(title: string, id: string): vscode.Command {
  return { title, command: id };
}

export function registerCodeLens(context: vscode.ExtensionContext): void {
  const provider: vscode.CodeLensProvider = {
    provideCodeLenses(document) {
      if (document.languageId !== "grpctestify") {
        return [];
      }
      const anchorLine = Math.min(document.lineCount - 1, 0);
      const anchorRange = new vscode.Range(anchorLine, 0, anchorLine, 0);

      return [
        new vscode.CodeLens(anchorRange, command("Run", "grpctestify.run")),
        new vscode.CodeLens(anchorRange, command("Check", "grpctestify.check")),
        new vscode.CodeLens(anchorRange, command("Format", "grpctestify.fmt")),
        new vscode.CodeLens(anchorRange, command("Inspect", "grpctestify.inspect")),
        new vscode.CodeLens(anchorRange, command("Explain", "grpctestify.explain")),
      ];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider("grpctestify", provider),
  );
}
