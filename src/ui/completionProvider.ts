import * as vscode from "vscode";

import { collectExtractVariables, collectJsonKeysFromDocument, collectJsonPathPrefixes, collectTemplateVarsFromRequest, findCurrentSection } from "./completion/collectors";
import { getEndpointCompletionsFromReflection } from "./completion/endpoint";
import { sectionCompletionItems, sectionHeaderOptionCompletionItems, sectionKeyCompletionItems } from "./completion/sections";

const REFLECTIONS_AVAILABLE = new Set([":", "/", ".", "-"]);

function templateVariableCompletionItems(
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const extractVars = collectExtractVariables(document);
  const section = findCurrentSection(document, new vscode.Position(document.lineCount - 1, 0));

  if (section !== "REQUEST") return [];

  return extractVars.map((varName) => {
    const item = new vscode.CompletionItem(
      `{{ ${varName} }}`,
      vscode.CompletionItemKind.Variable,
    );
    item.insertText = new vscode.SnippetString(`{{ ${varName} }}`);
    item.detail = `$(symbol-variable) Template variable from EXTRACT`;
    item.filterText = varName;
    item.sortText = "100";
    return item;
  });
}

function jsonBodyCompletionItems(
  section: string,
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  const keys = collectJsonKeysFromDocument(document);

  for (const key of keys) {
    const item = new vscode.CompletionItem(
      `"${key}": `,
      vscode.CompletionItemKind.Property,
    );
    item.insertText = `"${key}": `;
    item.detail = `$(symbol-field) JSON field`;
    item.sortText = "010";
    items.push(item);
  }

  return items;
}

function assertsCompletionItems(
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  const jsonPaths = collectJsonPathPrefixes(document);
  const extractVars = collectExtractVariables(document);

  const operators = [
    ["==", "Equality"],
    ["!=", "Inequality"],
    [">", "Greater than"],
    ["<", "Less than"],
    [">=", "Greater or equal"],
    ["<=", "Less or equal"],
    ["contains", "String/array contains"],
    ["matches", "Regex match"],
    ["startsWith", "Prefix check"],
    ["endsWith", "Suffix check"],
  ];

  const plugins = [
    ["@uuid(", "UUID validation"],
    ["@email(", "Email validation"],
    ["@ip(", "IP validation"],
    ["@url(", "URL validation"],
    ["@timestamp(", "Timestamp validation"],
    ["@len(", "Length check"],
    ["@empty(", "Empty check"],
    ["@regex(", "Regex match"],
    ["@elapsed_ms", "Elapsed time"],
    ["@total_elapsed_ms", "Total elapsed"],
    ["@scope_message_count", "Stream message count"],
    ["@scope_index", "Stream message index"],
    ["@header(", "Response header"],
    ["@trailer(", "Response trailer"],
    ["@has_header(", "Has header"],
    ["@has_trailer(", "Has trailer"],
    ["@env(", "Environment variable"],
  ];

  for (const path of jsonPaths.slice(0, 15)) {
    const item = new vscode.CompletionItem(path, vscode.CompletionItemKind.Variable);
    item.detail = "$(symbol-ruler) JSON path";
    item.insertText = path;
    item.sortText = "000";
    items.push(item);
  }

  for (const [op] of operators) {
    const item = new vscode.CompletionItem(op, vscode.CompletionItemKind.Operator);
    item.detail = `$(symbol-operator) ${operators.find((o) => o[0] === op)?.[1]}`;
    item.insertText = op;
    item.sortText = "001";
    items.push(item);
  }

  for (const [plug] of plugins) {
    const item = new vscode.CompletionItem(plug, vscode.CompletionItemKind.Function);
    item.detail = "$(symbol-function) Plugin function";
    item.insertText = plug;
    item.sortText = "002";
    items.push(item);
  }

  for (const varName of extractVars) {
    const item = new vscode.CompletionItem(
      `{{ ${varName} }}`,
      vscode.CompletionItemKind.Variable,
    );
    item.insertText = new vscode.SnippetString(`{{ ${varName} }}`);
    item.detail = `$(symbol-variable) From EXTRACT`;
    item.filterText = varName;
    item.sortText = "003";
    items.push(item);
  }

  return items;
}

function extractCompletionItems(
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  const jsonPaths = collectJsonPathPrefixes(document);
  const extractVars = collectExtractVariables(document);
  const templateVars = collectTemplateVarsFromRequest(document);

  for (const path of jsonPaths.slice(0, 15)) {
    const item = new vscode.CompletionItem(path, vscode.CompletionItemKind.Variable);
    item.detail = "$(symbol-ruler) JSON path";
    item.insertText = path;
    item.sortText = "000";
    items.push(item);
  }

  for (const varName of extractVars) {
    const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Variable);
    item.detail = "$(symbol-variable) Already extracted";
    item.insertText = varName;
    item.sortText = "001";
    items.push(item);
  }

  for (const varName of templateVars) {
    const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Variable);
    item.detail = "$(symbol-variable) Available from REQUEST";
    item.insertText = varName;
    item.sortText = "002";
    items.push(item);
  }

  const extractPlugins = [
    ["@header(", "Response header"],
    ["@trailer(", "Response trailer"],
    ["@env(", "Environment variable"],
  ];
  for (const [plug, desc] of extractPlugins) {
    const item = new vscode.CompletionItem(plug, vscode.CompletionItemKind.Function);
    item.detail = `$(symbol-function) ${desc}`;
    item.insertText = plug;
    item.sortText = "003";
    items.push(item);
  }

  const extractPrefix = jsonPaths
    .slice(0, 3)
    .map((p) => p.replace(/^\$\./, ""))
    .filter((p) => p.length > 0);
  for (const prefix of extractPrefix) {
    const item = new vscode.CompletionItem(
      `${prefix} = .${prefix}`,
      vscode.CompletionItemKind.Snippet,
    );
    item.detail = "$(symbol-variable) Extract variable";
    item.insertText = `${prefix} = .${prefix}`;
    item.sortText = "004";
    items.push(item);
  }

  const genericItem = new vscode.CompletionItem(
    "var = .path",
    vscode.CompletionItemKind.Snippet,
  );
  genericItem.detail = "$(symbol-variable) Extract from JQ path";
  genericItem.insertText = "${1:var} = ${2:.path}";
  genericItem.sortText = "005";
  items.push(genericItem);

  return items;
}

export function registerCompletionProvider(
  context: vscode.ExtensionContext,
  deps: { isLspRunning: () => boolean },
): void {
  const provider = vscode.languages.registerCompletionItemProvider(
    "grpctestify",
    {
      async provideCompletionItems(document, position) {
        const section = findCurrentSection(document, position);
        const linePrefix = document.lineAt(position.line).text.slice(
          0,
          position.character,
        );
        const trimmed = linePrefix.trimStart();

        if (/^---\s*$/.test(trimmed) || /^---\s+\w*$/.test(trimmed)) {
          return sectionCompletionItems(
            new vscode.Range(position.line, 0, position.line, position.character),
          );
        }

        if (
          section === "ENDPOINT" &&
          REFLECTIONS_AVAILABLE.has(trimmed.slice(-1)) &&
          !deps.isLspRunning()
        ) {
          const reflected = await getEndpointCompletionsFromReflection(document);
          const fallback = new vscode.CompletionItem(
            "Type package.Service/Method",
            vscode.CompletionItemKind.Text,
          );
          fallback.sortText = "zzz";
          return [fallback, ...reflected];
        }

        if ((section === "REQUEST" || section === "RESPONSE") && trimmed.endsWith("{{")) {
          return templateVariableCompletionItems(document);
        }

        const headerOpts = sectionHeaderOptionCompletionItems(section, document, position);
        if (headerOpts.length > 0) return headerOpts;

        const sectionKeyOpts = sectionKeyCompletionItems(section, document, position);
        if (sectionKeyOpts.length > 0) return sectionKeyOpts;

        if (section === "ASSERTS") {
          return assertsCompletionItems(document);
        }

        if (section === "EXTRACT") {
          return extractCompletionItems(document);
        }

        if (section === "REQUEST" || section === "RESPONSE") {
          return jsonBodyCompletionItems(section, document);
        }

        return undefined;
      },
    },
    ...["-", ":", "/", ".", " ", '"', "{", "[", ",", "\n", "`"],
  );

  context.subscriptions.push(provider);

  const autoSuggestTriggers = new Set(["-", ":", "/", ".", " ", '"', "{", "[", ",", "`"]);
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== "grpctestify") return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== event.document) return;
      const lastChar = event.contentChanges[0]?.text;
      if (lastChar && autoSuggestTriggers.has(lastChar)) {
        void vscode.commands.executeCommand("editor.action.triggerSuggest");
      }
    }),
  );
}
