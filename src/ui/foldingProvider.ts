import * as vscode from "vscode";

const SECTION_RE = /^---\s+([A-Z_]+)/;

export function registerFoldingProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.FoldingRangeProvider = {
    provideFoldingRanges(document, _context, _token) {
      const ranges: vscode.FoldingRange[] = [];
      let sectionStart: number | undefined;

      for (let i = 0; i < document.lineCount; i++) {
        const match = document.lineAt(i).text.trim().match(SECTION_RE);
        if (!match) continue;

        if (sectionStart !== undefined && i > sectionStart + 1) {
          ranges.push(new vscode.FoldingRange(sectionStart, i - 1));
        }
        sectionStart = i;
      }

      if (sectionStart !== undefined && sectionStart < document.lineCount - 1) {
        ranges.push(
          new vscode.FoldingRange(sectionStart, document.lineCount - 1),
        );
      }

      return ranges;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider("grpctestify", provider),
  );
}
