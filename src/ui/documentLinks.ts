import * as path from "node:path";
import * as vscode from "vscode";

const pathKeys = new Set([
  "descriptor",
  "ca_cert",
  "ca_file",
  "cert",
  "key",
  "client_cert",
  "cert_file",
  "client_key",
  "key_file",
]);

function parseCandidatePaths(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 && !part.startsWith("#") && !part.startsWith("//"),
    );
}

function toFileUri(
  document: vscode.TextDocument,
  candidate: string,
): vscode.Uri {
  if (path.isAbsolute(candidate)) {
    return vscode.Uri.file(candidate);
  }
  return vscode.Uri.file(
    path.resolve(path.dirname(document.uri.fsPath), candidate),
  );
}

export function registerDocumentLinks(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerDocumentLinkProvider(
    "grpctestify",
    {
      provideDocumentLinks(document) {
        const links: vscode.DocumentLink[] = [];

        for (let i = 0; i < document.lineCount; i += 1) {
          const text = document.lineAt(i).text;
          const match = text.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
          if (!match) {
            continue;
          }

          const [, key, rawValue] = match;
          if (!pathKeys.has(key) && key !== "files" && key !== "import_paths") {
            continue;
          }

          const paths = parseCandidatePaths(rawValue);
          for (const candidate of paths) {
            const start = text.indexOf(candidate);
            if (start < 0) {
              continue;
            }
            const range = new vscode.Range(
              i,
              start,
              i,
              start + candidate.length,
            );
            links.push(
              new vscode.DocumentLink(range, toFileUri(document, candidate)),
            );
          }
        }

        return links;
      },
    },
  );

  context.subscriptions.push(provider);
}
