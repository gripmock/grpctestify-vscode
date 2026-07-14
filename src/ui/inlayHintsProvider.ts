import * as vscode from "vscode";

interface ExtractVar {
  name: string;
  path: string;
  typeAnnotation?: string;
}

function collectExtractVars(document: vscode.TextDocument): ExtractVar[] {
  const vars: ExtractVar[] = [];
  let inExtract = false;

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text.trim();
    const sectionMatch = text.match(/^---\s+([A-Z_]+)/);
    if (sectionMatch) {
      inExtract = sectionMatch[1] === "EXTRACT";
      continue;
    }
    if (!inExtract || !text || text.startsWith("#") || text.startsWith("//")) {
      continue;
    }

    const extractMatch = text.match(
      /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/,
    );
    if (extractMatch) {
      vars.push({ name: extractMatch[1], path: `response.${extractMatch[1]}` });
      continue;
    }

    const assignMatch = text.match(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/,
    );
    if (assignMatch) {
      const path = assignMatch[2].trim();
      const typeMatch = path.match(/^(.*?)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/);
      if (typeMatch) {
        vars.push({
          name: assignMatch[1],
          path: typeMatch[1].trim(),
          typeAnnotation: typeMatch[2],
        });
      } else {
        vars.push({ name: assignMatch[1], path });
      }
    }
  }

  return vars;
}

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

export function registerInlayHintsProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.InlayHintsProvider = {
    provideInlayHints(document, _range, _token) {
      const hints: vscode.InlayHint[] = [];
      const extractVars = collectExtractVars(document);
      const varPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

      for (let i = 0; i < document.lineCount; i++) {
        const section = findCurrentSection(document, i);
        if (section !== "REQUEST" && section !== "RESPONSE") continue;

        const text = document.lineAt(i).text;
        let match: RegExpExecArray | null;
        while ((match = varPattern.exec(text)) !== null) {
          const varName = match[1];
          const extract = extractVars.find((v) => v.name === varName);
          if (!extract) continue;

          const label = `\u2190 ${extract.path}`;
          const pos = document.validatePosition(
            new vscode.Position(i, match.index + match[0].length),
          );
          const hint = new vscode.InlayHint(pos, label, vscode.InlayHintKind.Type);
          hints.push(hint);
        }
      }

      return hints;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider("grpctestify", provider),
  );
}
