import * as vscode from "vscode";
import { readdir } from "node:fs/promises";
import * as path from "node:path";

import { getProtocolArgs } from "../../commands/commandRuntime";
import { resolveGrpctestifyBinary } from "../../runtime/binaryResolver";
import { runProcess } from "../../runtime/processRunner";

const endpointCompletionCache = new Map<string, { expiresAt: number; values: string[] }>();

async function getReflectedEndpoints(address: string): Promise<string[]> {
  const now = Date.now();
  const cached = endpointCompletionCache.get(address);
  if (cached && now < cached.expiresAt) {
    return cached.values;
  }

  try {
    const binary = await resolveGrpctestifyBinary();
    const result = await runProcess(
      binary.resolvedPath,
      ["reflect", ...getProtocolArgs(), "--address", address],
      { timeoutMs: 4000 },
    );
    const methods: string[] = [];
    let currentService: string | undefined;
    for (const rawLine of result.stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
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
    const values = methods.sort();
    endpointCompletionCache.set(address, { expiresAt: now + 30000, values });
    return values;
  } catch {
    return [];
  }
}

async function getPathCompletionsForExtension(
  extGlob: string,
  document: vscode.TextDocument,
): Promise<string[]> {
  const documentDir = path.dirname(document.uri.fsPath);
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)
    ?.uri.fsPath ?? documentDir;

  const filesFromWorkspace: Promise<string[]> = new Promise((resolve) => {
    const thenable = vscode.workspace.findFiles(extGlob, "**/node_modules/**", 200);
    thenable.then(
      (uris) => resolve(uris.map((u) => u.fsPath)),
      () => resolve([]),
    );
  });

  const filesFromLocal: string[] = [];
  const maxDepth = 3;
  const visitDir = async (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          await visitDir(fullPath, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(extGlob.slice(1))) {
          filesFromLocal.push(fullPath);
        }
      }
    } catch {
      // skip unreadable dirs
    }
  };
  await visitDir(documentDir, 0);

  const workspaceFiles = await filesFromWorkspace;
  const allFiles = [...workspaceFiles, ...filesFromLocal].filter(
    (fp) => fp.startsWith(workspaceRoot),
  );
  return [...new Set(allFiles)].sort();
}

export async function getEndpointCompletionsFromReflection(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
  const address = extractAddressFromDocument(document);
  if (!address) return [];

  const methods = await getReflectedEndpoints(address);
  return methods.map((m) => new vscode.CompletionItem(m, vscode.CompletionItemKind.Method));
}

export async function getProtoPathCompletions(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
  const paths = await getPathCompletionsForExtension("**/*.{proto,desc,binpb}", document);
  return paths.map((fp) => new vscode.CompletionItem(fp, vscode.CompletionItemKind.File));
}

export async function getTlsPathCompletions(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
  const paths = await getPathCompletionsForExtension("**/*.{pem,crt,key}", document);
  return paths.map((fp) => new vscode.CompletionItem(fp, vscode.CompletionItemKind.File));
}

function extractAddressFromDocument(document: vscode.TextDocument): string | undefined {
  for (let i = 0; i < document.lineCount; i += 1) {
    const text = document.lineAt(i).text.trim();
    const sectionMatch = text.match(/^---\s+([A-Z_]+)/);
    if (sectionMatch) {
      if (sectionMatch[1] !== "ADDRESS") continue;
      let nextLine: string | undefined;
      for (let j = i + 1; j < document.lineCount; j += 1) {
        const candidate = document.lineAt(j).text.trim();
        if (candidate.startsWith("---")) {
          break;
        }
        if (candidate.length > 0 && !candidate.startsWith("#") && !candidate.startsWith("//")) {
          nextLine = candidate;
          break;
        }
      }
      return nextLine;
    }
  }
  return undefined;
}
