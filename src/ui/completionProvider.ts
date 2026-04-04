import * as vscode from "vscode";
import { readdir } from "node:fs/promises";
import * as path from "node:path";

import { resolveGrpctestifyBinary } from "../runtime/binaryResolver";
import { runProcess } from "../runtime/processRunner";

const endpointCompletionCache = new Map<
  string,
  { expiresAt: number; values: string[] }
>();

function sectionCompletionItems(
  replaceRange: vscode.Range,
): vscode.CompletionItem[] {
  const sections = [
    { label: "ADDRESS", snippet: "--- ADDRESS ---\n" },
    { label: "ENDPOINT", snippet: "--- ENDPOINT ---\n" },
    { label: "REQUEST", snippet: "--- REQUEST ---\n" },
    { label: "RESPONSE", snippet: "--- RESPONSE ---\n" },
    {
      label: "RESPONSE partial",
      snippet: "--- RESPONSE partial=true tolerance=0.001 ---\n",
    },
    { label: "ERROR", snippet: "--- ERROR ---\n" },
    { label: "REQUEST_HEADERS", snippet: "--- REQUEST_HEADERS ---\n" },
    { label: "ASSERTS", snippet: "--- ASSERTS ---\n" },
    { label: "EXTRACT", snippet: "--- EXTRACT ---\n" },
    { label: "TLS", snippet: "--- TLS ---\n" },
    { label: "PROTO", snippet: "--- PROTO ---\n" },
    { label: "OPTIONS", snippet: "--- OPTIONS ---\n" },
  ];

  return sections.map((section, index) => {
    const item = new vscode.CompletionItem(
      section.label.startsWith("RESPONSE partial")
        ? "--- RESPONSE partial=true tolerance=0.001 ---"
        : `--- ${section.label} ---`,
      vscode.CompletionItemKind.Snippet,
    );
    item.insertText = new vscode.SnippetString(section.snippet);
    item.range = replaceRange;
    item.detail = "gRPCTestify section";
    item.sortText = `0${String(index).padStart(2, "0")}`;
    return item;
  });
}

function sectionKeyCompletionItems(section: string | undefined): vscode.CompletionItem[] {
  if (section === "REQUEST" || section === "RESPONSE") {
    const jsonItems = [
      ['"key": "value"', '"${1:key}": "${2:value}"'],
      ['"count": 0', '"${1:count}": ${2:0}'],
      ['"enabled": true', '"${1:enabled}": ${2:true}'],
      ['"items": []', '"${1:items}": []'],
      ['"meta": {}', '"${1:meta}": {\n  $0\n}'],
    ] as const;

    return jsonItems.map(([label, snippet], index) => {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString(snippet);
      item.detail = `${section} JSON snippet`;
      item.sortText = `1${String(index).padStart(2, "0")}`;
      return item;
    });
  }

  if (section === "ASSERTS") {
    const assertItems = [
      [".field == value", "${1:.field} ${2:==} ${3:\"value\"}"],
      [".nested.field != null", "${1:.nested.field} ${2:!=} ${3:null}"],
      [".items | length > 0", "${1:.items | length} ${2:>} ${3:0}"],
      ["contains", "${1:.field} contains ${2:\"value\"}"],
      ["matches", "${1:.field} matches ${2:\"^regex$\"}"],
    ] as const;

    return assertItems.map(([label, snippet], index) => {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString(snippet);
      item.detail = "ASSERTS expression snippet";
      item.sortText = `1${String(index).padStart(2, "0")}`;
      return item;
    });
  }

  const entries = [
    ["descriptor", "./service.desc"],
    ["files", "[\"./service.proto\"]"],
    ["import_paths", "[\"./proto\"]"],
    ["ca_file", "./ca.pem"],
    ["cert_file", "./client.pem"],
    ["key_file", "./client.key"],
    ["server_name", "localhost"],
    ["insecure", "false"],
    ["timeout", "5s"],
    ["retries", "1"],
    ["parallel", "true"],
    ["sort", "path"],
    ["dry_run", "false"],
  ] as const;

  const allowedBySection: Record<string, Set<string>> = {
    PROTO: new Set(["descriptor", "files", "import_paths"]),
    TLS: new Set(["ca_file", "cert_file", "key_file", "server_name", "insecure"]),
    OPTIONS: new Set(["timeout", "retries", "parallel", "sort", "dry_run"]),
  };

  const allowed = section ? allowedBySection[section] : undefined;
  const scopedEntries = allowed
    ? entries.filter(([key]) => allowed.has(key))
    : entries;

  return scopedEntries.map(([key, value], index) => {
    const item = new vscode.CompletionItem(
      `${key}: ${value}`,
      vscode.CompletionItemKind.Property,
    );
    item.insertText = new vscode.SnippetString(`${key}: ${value}`);
    item.sortText = `1${String(index).padStart(2, "0")}`;
    return item;
  });
}

function sectionHeaderOptionCompletionItems(
  section: string | undefined,
): vscode.CompletionItem[] {
  if (section !== "RESPONSE") {
    return [];
  }

  const options = [
    ["partial=true", "Enable partial response matching"],
    ["with_asserts=true", "Run ASSERTS after response check"],
    ["tolerance=0.001", "Numeric tolerance for float comparisons"],
    ["unordered_arrays=true", "Ignore array item order"],
    ["redact=$.token", "Redact path in comparison"],
  ] as const;

  return options.map(([value, detail], index) => {
    const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Property);
    item.insertText = new vscode.SnippetString(`${value}`);
    item.detail = detail;
    item.sortText = `2${String(index).padStart(2, "0")}`;
    return item;
  });
}

function isCursorOnSectionHeader(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  const line = document.lineAt(position.line).text.trim();
  return /^---\s+[A-Z_]+\b.*---\s*$/.test(line);
}

function findCurrentSection(
  document: vscode.TextDocument,
  position: vscode.Position,
): string | undefined {
  for (let line = position.line; line >= 0; line -= 1) {
    const text = document.lineAt(line).text.trim();
    const match = text.match(/^---\s+([A-Z_]+)\b.*---\s*$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function extractAddress(document: vscode.TextDocument): string | undefined {
  let inAddress = false;
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text.trim();
    const section = text.match(/^---\s+([A-Z_]+)\b.*---\s*$/)?.[1];
    if (section) {
      inAddress = section === "ADDRESS";
      continue;
    }
    if (!inAddress || text.length === 0 || text.startsWith("#")) {
      continue;
    }
    return text;
  }
  return process.env.GRPCTESTIFY_ADDRESS ?? "localhost:4770";
}

async function getEndpointCompletionsFromReflection(
  address: string,
): Promise<vscode.CompletionItem[]> {
  const now = Date.now();
  const cached = endpointCompletionCache.get(address);
  if (cached && cached.expiresAt > now) {
    return cached.values.map((value) =>
      new vscode.CompletionItem(value, vscode.CompletionItemKind.Method),
    );
  }

  try {
    const binary = await resolveGrpctestifyBinary();
    const result = await runProcess(
      binary.resolvedPath,
      ["reflect", "--address", address],
      { timeoutMs: 4000 },
    );
    const methods: string[] = [];
    let currentService: string | undefined;
    for (const rawLine of result.stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line.startsWith("- ")) {
        const method = line.slice(2).trim();
        if (currentService && method.length > 0) {
          methods.push(`${currentService}/${method}`);
        }
        continue;
      }
      if (
        !line.startsWith("Connecting to") &&
        !line.startsWith("Available services") &&
        !line.startsWith("Total:")
      ) {
        currentService = line;
      }
    }
    const unique = Array.from(new Set(methods)).sort();
    endpointCompletionCache.set(address, {
      expiresAt: now + 30_000,
      values: unique,
    });

    return unique.map((value) => {
      const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Method);
      item.detail = `Reflected from ${address}`;
      return item;
    });
  } catch {
    return [];
  }
}

async function getProtoPathCompletions(
  document: vscode.TextDocument,
  currentLine: string,
): Promise<vscode.CompletionItem[]> {
  const normalized = currentLine.replace(/\s+/g, "");
  const isProtoKey =
    normalized.startsWith("descriptor:") ||
    normalized.startsWith("files:") ||
    normalized.startsWith("import_paths:");
  if (!isProtoKey || document.uri.scheme !== "file") {
    return [];
  }

  const workspaceRoot =
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
    path.dirname(document.uri.fsPath);
  const baseDir = path.dirname(document.uri.fsPath);

  const protoUris = await vscode.workspace.findFiles(
    "**/*.proto",
    "**/node_modules/**",
    200,
  );
  const descUris = await vscode.workspace.findFiles(
    "**/*.{desc,binpb}",
    "**/node_modules/**",
    200,
  );

  const filesFromWorkspace = [...protoUris, ...descUris]
    .map((uri) => uri.fsPath)
    .filter((fsPath) => fsPath.startsWith(workspaceRoot));

  const filesFromLocalTree: string[] = [];
  if (filesFromWorkspace.length === 0) {
    const queue: Array<{ dir: string; depth: number }> = [
      { dir: baseDir, depth: 0 },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.depth > 3) {
        continue;
      }
      try {
        const entries = await readdir(current.dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") {
            continue;
          }
          const fullPath = path.join(current.dir, entry.name);
          if (entry.isDirectory()) {
            queue.push({ dir: fullPath, depth: current.depth + 1 });
            continue;
          }
          if (/\.(proto|desc|binpb)$/i.test(entry.name)) {
            filesFromLocalTree.push(fullPath);
          }
        }
      } catch {
        // Ignore per-directory read errors.
      }
    }
  }

  const files = [...filesFromWorkspace, ...filesFromLocalTree];

  const importPaths = new Set<string>();
  for (const proto of protoUris.map((uri) => uri.fsPath)) {
    const relDir = path.relative(baseDir, path.dirname(proto));
    importPaths.add(relDir.length > 0 ? relDir : ".");
  }

  if (normalized.startsWith("import_paths:")) {
    return Array.from(importPaths)
      .sort()
      .map((dir) => {
        const item = new vscode.CompletionItem(
          `"${dir}"`,
          vscode.CompletionItemKind.Folder,
        );
        item.insertText = new vscode.SnippetString(`"${dir}"`);
        item.detail = "Import path (relative to .gctf)";
        return item;
      });
  }

  return files
    .map((fsPath) => path.relative(baseDir, fsPath))
    .filter((rel) => rel.length > 0)
    .sort()
    .map((rel) => {
      const item = new vscode.CompletionItem(
        `"${rel}"`,
        vscode.CompletionItemKind.File,
      );
      item.insertText = new vscode.SnippetString(`"${rel}"`);
      item.detail = "Path relative to .gctf";
      return item;
    });
}

export function registerCompletionProvider(
  context: vscode.ExtensionContext,
  dependencies: {
    isLspRunning: () => boolean;
  },
): void {
  const provider = vscode.languages.registerCompletionItemProvider(
    { language: "grpctestify", scheme: "file" },
    {
      async provideCompletionItems(document, position) {
        const lineText = document.lineAt(position.line).text;
        const currentLine = lineText.trim();
        const linePrefixRaw = lineText.slice(0, position.character);
        const linePrefix = linePrefixRaw.trim();
        const currentSection = findCurrentSection(document, position);

        const replaceRange = new vscode.Range(
          new vscode.Position(position.line, 0),
          new vscode.Position(position.line, lineText.length),
        );

        if (/^\s*-*$/.test(linePrefixRaw) || /^---\s*[A-Z_]*$/.test(linePrefix)) {
          return sectionCompletionItems(replaceRange);
        }

        if (isCursorOnSectionHeader(document, position)) {
          const headerOptions = sectionHeaderOptionCompletionItems(currentSection);
          if (headerOptions.length > 0) {
            return headerOptions;
          }
        }

        if (currentSection === "ENDPOINT") {
          if (dependencies.isLspRunning()) {
            return [];
          }

          const address = extractAddress(document);
          const reflected = address
            ? await getEndpointCompletionsFromReflection(address)
            : [];
          const fallback = new vscode.CompletionItem(
            "package.Service/Method",
            vscode.CompletionItemKind.Snippet,
          );
          fallback.insertText = new vscode.SnippetString(
            "${1:package}.${2:Service}/${3:Method}",
          );
          fallback.detail = "Endpoint template";
          fallback.sortText = "0000";
          return [fallback, ...reflected];
        }

        if (currentSection === "PROTO") {
          const protoPaths = await getProtoPathCompletions(document, currentLine);
          if (protoPaths.length > 0) {
            return protoPaths;
          }
        }

        return sectionKeyCompletionItems(currentSection);
      },
    },
    "-",
    ":",
    "/",
    ".",
    '"',
    "{",
    "[",
    ",",
    " ",
  );

  context.subscriptions.push(provider);

  const autoSuggestTriggers = new Set([
    "-",
    ":",
    "/",
    ".",
    '"',
    "{",
    "[",
    ",",
    " ",
  ]);
  const autoSuggest = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
      return;
    }
    if (event.document.languageId !== "grpctestify") {
      return;
    }
    if (event.contentChanges.length !== 1) {
      return;
    }
    const change = event.contentChanges[0];
    if (!change || change.text.length !== 1 || !autoSuggestTriggers.has(change.text)) {
      return;
    }

    void vscode.commands.executeCommand("editor.action.triggerSuggest");
  });
  context.subscriptions.push(autoSuggest);
}
