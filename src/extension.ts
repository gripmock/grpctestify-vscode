import * as vscode from 'vscode';
import { GRPCTestifyDiagnostics } from './diagnostics';

function getExistingSections(document: vscode.TextDocument): string[] {
  const sections = ['ADDRESS', 'ENDPOINT', 'REQUEST', 'RESPONSE', 'ERROR'];
  return sections.filter(section => 
    new RegExp(`--- ${section} ---`, 'g').test(document.getText())
  );
}

export function activate(context: vscode.ExtensionContext) {
  // Validation
  const diagnostics = new GRPCTestifyDiagnostics(context);
  vscode.workspace.onDidChangeTextDocument(e => {
    if (e.document.languageId === 'grpctestify') {
      diagnostics.validate(e.document);
    }
  });

  // Suggestions
  const provider = vscode.languages.registerCompletionItemProvider(
    'grpctestify',
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        const line = document.lineAt(position);
        const lineText = line.text.slice(0, position.character);

        // Section suggestions
        if (/^(---\s*)$/.test(lineText)) {
          const existing = getExistingSections(document);
          const available = ['ADDRESS', 'ENDPOINT', 'REQUEST', 'RESPONSE', 'ERROR']
            .filter(s => !existing.includes(s));

          return available.map(section => {
            const item = new vscode.CompletionItem(
              section,
              vscode.CompletionItemKind.Snippet
            );
            item.insertText = new vscode.SnippetString(`--- ${section} ---`);
            item.range = new vscode.Range(
              position.with({ character: 0 }),
              position.with({ character: lineText.length })
            );
            return item;
          });
        }

        // Suggestions for ENDPOINT
        if (lineText.includes('--- ENDPOINT ---')) {
          return [
            new vscode.CompletionItem('my.package.Service/Method', vscode.CompletionItemKind.Value)
          ];
        }

        return undefined;
      }
    },
    '-'
  );

  context.subscriptions.push(provider);
}

export function deactivate() {}