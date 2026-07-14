import type * as vscode from "vscode";

import { META_KEYS } from "./constants";

const scanCache = new Map<string, { version: number; result: unknown }>();

function memoizedScan<T>(doc: vscode.TextDocument, key: string, fn: () => T): T {
  const cacheKey = `${doc.uri.toString()}:${key}`;
  const cached = scanCache.get(cacheKey);
  if (cached && cached.version === doc.version) {
    return cached.result as T;
  }
  const result = fn();
  scanCache.set(cacheKey, { version: doc.version, result });
  return result;
}

export function collectJsonKeysFromDocument(document: vscode.TextDocument): string[] {
  return memoizedScan(document, "jsonKeys", () => {
    const keys = new Set<string>();
    const keyPattern = /"([A-Za-z_][A-Za-z0-9_-]*)"\s*:/g;
    const json5KeyPattern = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/;

    for (let i = 0; i < document.lineCount; i += 1) {
      const line = document.lineAt(i).text;
      for (const match of line.matchAll(keyPattern)) {
        if (match[1]) keys.add(match[1]);
      }
      const json5Match = line.match(json5KeyPattern);
      if (json5Match?.[1]) keys.add(json5Match[1]);
    }

    return Array.from(keys).sort();
  });
}

export function collectJsonPathPrefixes(document: vscode.TextDocument): string[] {
  return memoizedScan(document, "jsonPaths", () => {
    const paths = new Set<string>();
    let depth = 0;
    let currentPath = "$";

    for (let i = 0; i < document.lineCount; i += 1) {
      const text = document.lineAt(i).text.trim();
      if (/^---\s+[A-Z_]/.test(text)) {
        depth = 0;
        currentPath = "$";
        continue;
      }

      const openCount = (text.match(/\{/g) || []).length;
      const closeCount = (text.match(/\}/g) || []).length;

      if (closeCount > 0 && depth > 0) {
        const lastDot = currentPath.lastIndexOf(".");
        currentPath = lastDot > 0 ? currentPath.slice(0, lastDot) : "$";
      }

      depth += openCount - closeCount;

      const keyMatch = text.match(/^\s*"?([A-Za-z_][A-Za-z0-9_-]*)"?\s*:/);
      if (keyMatch) {
        currentPath = `${currentPath}.${keyMatch[1]}`;
        if (!paths.has(currentPath)) {
          paths.add(currentPath);
        }
      }
    }

    return Array.from(paths).sort();
  });
}

export function collectExtractVariables(document: vscode.TextDocument): string[] {
  return memoizedScan(document, "extractVars", () => {
    const vars: string[] = [];
    let inExtract = false;

    for (let i = 0; i < document.lineCount; i += 1) {
      const text = document.lineAt(i).text.trim();
      const sectionMatch = text.match(/^---\s+([A-Z_]+)/);
      if (sectionMatch) {
        inExtract = sectionMatch[1] === "EXTRACT";
        continue;
      }
      if (!inExtract || !text || text.startsWith("#") || text.startsWith("//")) continue;

      const assignMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*.+/);
      if (assignMatch) {
        vars.push(assignMatch[1]);
      }
    }

    return vars;
  });
}

export function collectTemplateVarsFromRequest(document: vscode.TextDocument): string[] {
  return memoizedScan(document, "templateVars", () => {
    const vars = new Set<string>();
    let inRequest = false;
    const varPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

    for (let i = 0; i < document.lineCount; i += 1) {
      const text = document.lineAt(i).text;
      const sectionMatch = text.trim().match(/^---\s+([A-Z_]+)/);
      if (sectionMatch) {
        inRequest = sectionMatch[1] === "REQUEST";
        continue;
      }
      if (!inRequest) continue;
      for (const match of text.matchAll(varPattern)) {
        if (match[1]) vars.add(match[1]);
      }
    }

    return Array.from(vars).sort();
  });
}

export function collectUsedMetaKeys(document: vscode.TextDocument, upToLine: number): Set<string> {
  const used = new Set<string>();
  for (let i = 0; i < upToLine; i += 1) {
    const text = document.lineAt(i).text.trim();
    const sectionMatch = text.match(/^---\s+([A-Z_]+)/);
    if (sectionMatch && sectionMatch[1] !== "META") break;
    const keyMatch = text.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (keyMatch?.[1] && META_KEYS.has(keyMatch[1])) {
      used.add(keyMatch[1]);
    }
  }
  return used;
}

export function collectUsedInlineOptions(document: vscode.TextDocument, position: vscode.Position): Set<string> {
  const line = document.lineAt(position.line).text.trim();
  const used = new Set<string>();
  const sectionHeader = line.match(/^---\s+\w+\s+(.+?)---$/);
  if (sectionHeader) {
    const opts = sectionHeader[1].trim();
    if (opts) {
      for (const opt of opts.split(/\s+/)) {
        const name = opt.split("=")[0]?.trim();
        if (name) used.add(name);
      }
    }
  }
  return used;
}

export function findCurrentSection(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  for (let i = position.line; i >= 0; i -= 1) {
    const text = document.lineAt(i).text.trim();
    const match = text.match(/^---\s+([A-Z_]+)/);
    if (match) return match[1];
  }
  return undefined;
}
