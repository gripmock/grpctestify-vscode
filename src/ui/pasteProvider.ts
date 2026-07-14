import * as vscode from "vscode";

function findCurrentSection(
  document: vscode.TextDocument,
  line: number,
): string | undefined {
  for (let i = line; i >= 0; i--) {
    const match = document.lineAt(i).text.trim().match(/^---\s+([A-Z_]+)/);
    if (match) return match[1];
  }
  return undefined;
}

function isInRequestOrResponse(document: vscode.TextDocument, ranges: readonly vscode.Range[]): boolean {
  if (ranges.length === 0) return false;
  const section = findCurrentSection(document, ranges[0].start.line);
  return section === "REQUEST" || section === "RESPONSE";
}

export function registerPasteProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentPasteEditProvider = {
    async provideDocumentPasteEdits(
      document,
      ranges,
      dataTransfer,
      _context,
      _token,
    ) {
      if (!isInRequestOrResponse(document, ranges)) return undefined;

      const textThenable = dataTransfer.get("text/plain")?.asString();
      if (!textThenable) return undefined;
      const text = await textThenable;
      if (!text) return undefined;

      const trimmed = text.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return undefined;
      }

      const pretty = JSON.stringify(parsed, null, 2);
      if (pretty === trimmed) return undefined;

      const edit = new vscode.DocumentPasteEdit(
        pretty,
        "Convert to formatted JSON",
        vscode.DocumentDropOrPasteEditKind.Empty,
      );
      return [edit];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      "grpctestify",
      provider,
      {
        providedPasteEditKinds: [],
        pasteMimeTypes: ["text/plain"],
      },
    ),
  );
}
