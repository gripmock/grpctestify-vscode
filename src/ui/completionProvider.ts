import * as vscode from "vscode";
import { readdir } from "node:fs/promises";
import * as path from "node:path";

import { resolveGrpctestifyBinary } from "../runtime/binaryResolver";
import { runProcess } from "../runtime/processRunner";

const endpointCompletionCache = new Map<
  string,
  { expiresAt: number; values: string[] }
>();

const COMMIT_JSON = ['"', "{", "[", ","];
const COMMIT_KEY = [" ", ":"];
const COMMIT_YAML = [" ", ":", "\n"];

const GRPC_STATUS_CODES: Array<[number, string, string]> = [
  [0, "OK", "Success"],
  [1, "CANCELLED", "Operation cancelled by caller"],
  [2, "UNKNOWN", "Unknown or unclassifiable error"],
  [3, "INVALID_ARGUMENT", "Client specified an invalid argument"],
  [4, "DEADLINE_EXCEEDED", "Deadline expired before completion"],
  [5, "NOT_FOUND", "Requested resource was not found"],
  [6, "ALREADY_EXISTS", "Attempt to create a resource that already exists"],
  [7, "PERMISSION_DENIED", "Caller does not have permission"],
  [8, "RESOURCE_EXHAUSTED", "A resource quota has been exceeded"],
  [9, "FAILED_PRECONDITION", "Precondition check failed"],
  [10, "ABORTED", "Operation aborted due to concurrency conflict"],
  [11, "OUT_OF_RANGE", "Value is out of valid range"],
  [12, "UNIMPLEMENTED", "Method not implemented by the server"],
  [13, "INTERNAL", "Internal server error"],
  [14, "UNAVAILABLE", "Service is currently unavailable"],
  [15, "DATA_LOSS", "Unrecoverable data loss or corruption"],
  [16, "UNAUTHENTICATED", "Request lacks valid authentication"],
];

const META_KEYS = new Set(["name", "summary", "tags", "owner", "links"]);

const COMMON_TAGS = [
  "smoke",
  "regression",
  "integration",
  "e2e",
  "unit",
  "slow",
  "fast",
  "flaky",
  "critical",
  "wip",
  "draft",
];

function mk(
  label: string,
  kind: vscode.CompletionItemKind,
  opts: {
    insertText: string | vscode.SnippetString;
    detail: string;
    doc?: string;
    sortText: string;
    commitCharacters?: string[];
    filterText?: string;
  },
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, kind);
  if (opts.insertText instanceof vscode.SnippetString) {
    item.insertText = opts.insertText;
  } else {
    item.insertText = opts.insertText;
  }
  item.detail = opts.detail;
  if (opts.doc) {
    item.documentation = new vscode.MarkdownString(opts.doc);
  }
  item.sortText = opts.sortText;
  if (opts.commitCharacters) {
    item.commitCharacters = opts.commitCharacters;
  }
  if (opts.filterText !== undefined) {
    item.filterText = opts.filterText;
  }
  return item;
}

function sectionCompletionItems(
  replaceRange: vscode.Range,
): vscode.CompletionItem[] {
  const sections: Array<{
    label: string;
    snippet: string;
    detail: string;
    doc: string;
  }> = [
    {
      label: "META",
      snippet: "--- META ---\n",
      detail: "$(tag) Test metadata",
      doc: "YAML front-matter: `name`, `summary`, `tags`, `owner`, `links`. Must be first section.",
    },
    {
      label: "ADDRESS",
      snippet: "--- ADDRESS ---\n",
      detail: "$(globe) Server address",
      doc: "`host:port` of the gRPC server. Exactly one per document.",
    },
    {
      label: "ENDPOINT",
      snippet: "--- ENDPOINT ---\n",
      detail: "$(symbol-method) RPC method",
      doc: "`package.Service/Method`. Resolved via reflection or PROTO.",
    },
    {
      label: "REQUEST",
      snippet: "--- REQUEST ---\n",
      detail: "$(arrow-right) Request body",
      doc: "JSON5 body (trailing commas, `//` comments, `{{var}}` templates).",
    },
    {
      label: "RESPONSE",
      snippet: "--- RESPONSE ---\n",
      detail: "$(arrow-left) Expected response",
      doc: "Expected JSON body. Supports inline options: `partial`, `with_asserts`, `tolerance=N`, `unordered_arrays`, `redact=[...]`.",
    },
    {
      label: "RESPONSE partial",
      snippet: "--- RESPONSE partial tolerance=0.001 ---\n",
      detail: "$(arrow-left) Partial response",
      doc: "Subset matching with numeric tolerance. Only fields in expected are checked.",
    },
    {
      label: "ERROR",
      snippet: "--- ERROR ---\n",
      detail: "$(error) Expected error",
      doc: 'Expected gRPC error: simple string (substring match) or `{ "code", "message", "details" }`.',
    },
    {
      label: "REQUEST_HEADERS",
      snippet: "--- REQUEST_HEADERS ---\n",
      detail: "$(file-symlink-file) Custom headers",
      doc: "One `key: value` pair per line.",
    },
    {
      label: "ASSERTS",
      snippet: "--- ASSERTS ---\n",
      detail: "$(check) Assertions",
      doc: "Boolean expressions with operators, plugins, and JQ paths.",
    },
    {
      label: "EXTRACT",
      snippet: "--- EXTRACT ---\n",
      detail: "$(symbol-variable) Extract variables",
      doc: "`var = .jq.path`. Available as `{{var}}` in REQUEST.",
    },
    {
      label: "TLS",
      snippet: "--- TLS ---\n",
      detail: "$(lock) TLS / mTLS",
      doc: "`ca_cert`, `cert`, `key`, `server_name`, `insecure`.",
    },
    {
      label: "PROTO",
      snippet: "--- PROTO ---\n",
      detail: "$(file-code) Proto source",
      doc: "`descriptor` (compiled) or `files` + `import_paths` (source).",
    },
    {
      label: "OPTIONS",
      snippet: "--- OPTIONS ---\n",
      detail: "$(settings-gear) Request options",
      doc: "`timeout`, `retry`, `retry-delay`, `no-retry`, `compression`.",
    },
  ];

  return sections
    .map((section, index) => {
      const displayLabel = section.label.startsWith("RESPONSE partial")
        ? "--- RESPONSE partial tolerance=0.001 ---"
        : `--- ${section.label} ---`;
      return mk(displayLabel, vscode.CompletionItemKind.Snippet, {
        insertText: new vscode.SnippetString(section.snippet),
        detail: section.detail,
        doc: section.doc,
        sortText: `0${String(index).padStart(2, "0")}`,
      });
    })
    .map((item) => {
      item.range = replaceRange;
      return item;
    });
}

function collectJsonKeysFromDocument(document: vscode.TextDocument): string[] {
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
}

function collectJsonPathPrefixes(document: vscode.TextDocument): string[] {
  const paths = new Set<string>();
  const currentPath: string[] = [];
  let inSection = false;

  for (let i = 0; i < document.lineCount; i += 1) {
    const text = document.lineAt(i).text.trim();
    const sectionMatch = text.match(/^---\s+([A-Z_]+)/);
    if (sectionMatch) {
      const sec = sectionMatch[1];
      inSection = sec === "REQUEST" || sec === "RESPONSE";
      currentPath.length = 0;
      continue;
    }
    if (!inSection) continue;
    if (!text || text.startsWith("#") || text.startsWith("//")) continue;

    const depthChange =
      (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;
    const keyMatch = text.match(/"([A-Za-z_][A-Za-z0-9_-]*)"\s*:/);
    if (keyMatch?.[1]) {
      const fullPath =
        currentPath.length > 0
          ? `.${currentPath.join(".")}.${keyMatch[1]}`
          : `.${keyMatch[1]}`;
      paths.add(fullPath);
    }
    if (depthChange > 0 && keyMatch?.[1]) {
      currentPath.push(keyMatch[1]);
    }
    while (currentPath.length > 0 && depthChange < 0) {
      currentPath.pop();
    }
  }

  return Array.from(paths).sort();
}

function collectExtractVariables(document: vscode.TextDocument): string[] {
  const vars = new Set<string>();
  let inExtract = false;

  for (let i = 0; i < document.lineCount; i += 1) {
    const text = document.lineAt(i).text.trim();
    const sectionMatch = text.match(/^---\s+([A-Z_]+)/);
    if (sectionMatch) {
      inExtract = sectionMatch[1] === "EXTRACT";
      continue;
    }
    if (!inExtract || !text || text.startsWith("#") || text.startsWith("//"))
      continue;
    const eqIdx = text.indexOf("=");
    if (eqIdx > 0) {
      const varName = text.slice(0, eqIdx).trim();
      if (varName && /^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
        vars.add(varName);
      }
    }
  }

  return Array.from(vars).sort();
}

function collectTemplateVarsFromRequest(
  document: vscode.TextDocument,
): string[] {
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
}

function collectUsedMetaKeys(
  document: vscode.TextDocument,
  upToLine: number,
): Set<string> {
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

function collectUsedInlineOptions(
  document: vscode.TextDocument,
  position: vscode.Position,
): Set<string> {
  const line = document.lineAt(position.line).text.trim();
  const used = new Set<string>();
  const optionPattern =
    /\b(partial|with_asserts|tolerance|unordered_arrays|redact)\b/g;
  for (const match of line.matchAll(optionPattern)) {
    used.add(match[1]);
  }
  return used;
}

function metaKeyCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] {
  const used = collectUsedMetaKeys(document, position.line);

  const items: Array<{
    key: string;
    snippet: string;
    detail: string;
    doc: string;
  }> = [
    {
      key: "name",
      snippet: "name: ${1:test name}",
      detail: "Test name",
      doc: "Human-readable test name. Shown in reports and CLI output.",
    },
    {
      key: "summary",
      snippet: "summary: ${1:short description}",
      detail: "One-line summary",
      doc: "Brief description of what this test validates.",
    },
    {
      key: "tags",
      snippet: "tags: [${1:smoke}, ${2:regression}]",
      detail: "Filter tags",
      doc: "Tags for `--tags` / `--skip-tags` filtering. Both flow `[a, b]` and block `- a` styles.",
    },
    {
      key: "owner",
      snippet: "owner: ${1:team-name}",
      detail: "Test owner",
      doc: "Team or person responsible for this test.",
    },
    {
      key: "links",
      snippet: "links:\n  - ${1:https://example.com/spec}",
      detail: "Related links",
      doc: "Related URLs: design docs, JIRA, specs.",
    },
  ];

  return items
    .filter((item) => !used.has(item.key))
    .map((item, index) =>
      mk(item.key, vscode.CompletionItemKind.Property, {
        insertText: new vscode.SnippetString(item.snippet),
        detail: item.detail,
        doc: item.doc,
        sortText: `0${String(index).padStart(2, "0")}`,
        commitCharacters: COMMIT_YAML,
      }),
    );
}

function metaValueCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] {
  const line = document.lineAt(position.line).text;
  const keyMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*/);
  if (!keyMatch) return [];
  const key = keyMatch[1];
  const valueStart = keyMatch[0].length;
  const currentIndent = line.search(/\S/);

  if (key === "tags") {
    return COMMON_TAGS.map((tag, idx) =>
      mk(tag, vscode.CompletionItemKind.EnumMember, {
        insertText: tag,
        detail: "Common tag",
        sortText: `0${String(idx).padStart(2, "0")}`,
      }),
    );
  }

  if (key === "links") {
    if (line.trimEnd().endsWith(":") || line.slice(valueStart).trim() === "") {
      const indent = " ".repeat(currentIndent >= 0 ? currentIndent : 0);
      return [
        mk("- https://", vscode.CompletionItemKind.Snippet, {
          insertText: new vscode.SnippetString(
            `\n${indent}  - \${1:https://example.com}`,
          ),
          detail: "Add a URL",
          sortText: "000",
        }),
      ];
    }
  }

  return [];
}

function grpcErrorCodeItems(): vscode.CompletionItem[] {
  return GRPC_STATUS_CODES.map(([code, name, desc], idx) =>
    mk(`${code}`, vscode.CompletionItemKind.EnumMember, {
      insertText: `${code}`,
      detail: `${name} — ${desc}`,
      doc: `**${code} ${name}**\n\n${desc}`,
      sortText: `0${String(idx).padStart(2, "0")}`,
    }),
  );
}

function errorSectionCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] {
  const line = document.lineAt(position.line).text.trimStart();
  const currentSection = findCurrentSection(document, position);
  if (currentSection !== "ERROR") return [];

  if (/"code"\s*:\s*\d*$/.test(line)) {
    return grpcErrorCodeItems();
  }

  const jsonKeyMatch = line.match(/^\s*"([A-Za-z_][A-Za-z0-9_-]*)"\s*:\s*/);
  if (jsonKeyMatch) {
    if (jsonKeyMatch[1] === "code") return grpcErrorCodeItems();
    return [];
  }

  const isEmpty =
    line === "" ||
    line === "{" ||
    line === "{" ||
    line === "//" ||
    line.startsWith("#");

  if (!isEmpty) return [];

  return [
    mk("gRPC error with code", vscode.CompletionItemKind.Snippet, {
      insertText: new vscode.SnippetString(
        [
          "{",
          '  "code": ${1:5},',
          '  "message": "${2:entity not found}"',
          "}",
        ].join("\n"),
      ),
      detail: "$(error) Standard gRPC error",
      doc: [
        "**Fields:**",
        '- `"code"` — gRPC status code (0–16). Exact match.',
        '- `"message"` — substring match against actual error message.',
        '- `"details"` — optional array. Exact element match.',
      ].join("\n\n"),
      sortText: "000",
      commitCharacters: COMMIT_JSON,
    }),
    mk("gRPC error with details", vscode.CompletionItemKind.Snippet, {
      insertText: new vscode.SnippetString(
        [
          "{",
          '  "code": ${1:5},',
          '  "message": "${2:entity not found}",',
          '  "details": [',
          '    { "@type": "${3:type.googleapis.com/google.rpc.ErrorInfo}", "reason": "${4:reason}" }',
          "  ]",
          "}",
        ].join("\n"),
      ),
      detail: "$(error) gRPC error with rich details",
      doc: "Full error with `details` array. Each detail should have an `@type` field.",
      sortText: "001",
      commitCharacters: COMMIT_JSON,
    }),
    mk('"error message"', vscode.CompletionItemKind.Snippet, {
      insertText: new vscode.SnippetString('"${1:error message}"'),
      detail: "$(quote) Simple string match",
      doc: [
        "Simple string: actual error message must **contain** this substring.",
        "",
        'Example: `"not found"` matches `"user not found"`.',
      ].join("\n"),
      sortText: "002",
      commitCharacters: ['"', "\n"],
    }),
  ];
}

function templateVariableCompletionItems(
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const vars = collectExtractVariables(document);
  if (vars.length === 0) return [];

  return vars.map((varName, idx) =>
    mk(`{{${varName}}}`, vscode.CompletionItemKind.Variable, {
      insertText: new vscode.SnippetString(`{{ ${varName} }}`),
      detail: "$(symbol-variable) From EXTRACT",
      doc: [
        "Template variable resolved at execution time.",
        "",
        "Defined in EXTRACT as `" + varName + " = ...`",
        "",
        "| Context | Behaviour |",
        "|---|---|",
        "| Entire value is `{{var}}` | Type-preserving |",
        '| Embedded in `"text {{var}}"` | String interpolation |',
      ].join("\n"),
      sortText: `a${String(idx).padStart(2, "0")}`,
      filterText: varName,
    }),
  );
}

function jsonBodyCompletionItems(
  section: string,
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const result: vscode.CompletionItem[] = [];

  const templateVars = templateVariableCompletionItems(document);
  result.push(...templateVars);

  const docKeys = collectJsonKeysFromDocument(document);
  const keyItems = docKeys.map((key, index) =>
    mk(`"${key}":`, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(`"${key}": $1`),
      detail: "$(file-symlink-file) Key from document",
      doc: `Reuse existing key \`${key}\` from elsewhere in this file.`,
      sortText: `b${String(index).padStart(2, "0")}`,
      commitCharacters: COMMIT_KEY,
    }),
  );
  result.push(...keyItems);

  const primitives: Array<{
    label: string;
    snippet: string;
    detail: string;
  }> = [
    {
      label: '"key": "value"',
      snippet: '"${1:key}": "${2:value}"',
      detail: "String field",
    },
    {
      label: '"key": 0',
      snippet: '"${1:key}": ${2:0}',
      detail: "Number field",
    },
    {
      label: '"key": true',
      snippet: '"${1:key}": ${2|true,false|}',
      detail: "Boolean field",
    },
    {
      label: '"key": null',
      snippet: '"${1:key}": null',
      detail: "Null field",
    },
    {
      label: '"key": []',
      snippet: '"${1:key}": [\n  $0\n]',
      detail: "Array field",
    },
    {
      label: '"key": {}',
      snippet: '"${1:key}": {\n  $0\n}',
      detail: "Object field",
    },
  ];

  const primitiveItems = primitives.map((p, index) =>
    mk(p.label, vscode.CompletionItemKind.Snippet, {
      insertText: new vscode.SnippetString(p.snippet),
      detail: p.detail,
      sortText: `c${String(index).padStart(2, "0")}`,
      commitCharacters: COMMIT_JSON,
    }),
  );
  result.push(...primitiveItems);

  return result;
}

function assertsCompletionItems(
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const result: vscode.CompletionItem[] = [];

  const vars = collectExtractVariables(document);
  for (const varName of vars) {
    result.push(
      mk(`{{${varName}}}`, vscode.CompletionItemKind.Variable, {
        insertText: new vscode.SnippetString(`{{ ${varName} }}`),
        detail: "$(symbol-variable) From EXTRACT",
        sortText: "a00",
        filterText: varName,
      }),
    );
  }

  const jsonPaths = collectJsonPathPrefixes(document);
  for (const jp of jsonPaths.slice(0, 15)) {
    result.push(
      mk(jp, vscode.CompletionItemKind.Field, {
        insertText: jp,
        detail: "$(file-symlink-file) JSON path from document",
        sortText: "a01",
      }),
    );
  }

  const snippets: Array<{
    label: string;
    snippet: string;
    detail: string;
    doc: string;
    kind: vscode.CompletionItemKind;
  }> = [
    {
      label: ".field == value",
      snippet: '${1:.field} ${2:==} ${3:"value"}',
      detail: "$(check) Equality",
      doc: "Equality check. Works for strings, numbers, booleans, null.",
      kind: vscode.CompletionItemKind.Snippet,
    },
    {
      label: ".field != value",
      snippet: "${1:.field} ${2:!=} ${3:null}",
      detail: "$(check) Inequality",
      doc: "Negation of `==`.",
      kind: vscode.CompletionItemKind.Snippet,
    },
    {
      label: ".field > N",
      snippet: "${1:.field} ${2:>} ${3:0}",
      detail: "$(check) Greater than",
      doc: "Numeric comparison.",
      kind: vscode.CompletionItemKind.Snippet,
    },
    {
      label: ".field < N",
      snippet: "${1:.field} ${2:<} ${3:100}",
      detail: "$(check) Less than",
      doc: "Numeric comparison.",
      kind: vscode.CompletionItemKind.Snippet,
    },
    {
      label: ".field >= N",
      snippet: "${1:.field} ${2:>=} ${3:0}",
      detail: "$(check) Greater or equal",
      doc: "Numeric comparison.",
      kind: vscode.CompletionItemKind.Snippet,
    },
    {
      label: ".field <= N",
      snippet: "${1:.field} ${2:<=} ${3:0}",
      detail: "$(check) Less or equal",
      doc: "Numeric comparison.",
      kind: vscode.CompletionItemKind.Snippet,
    },
    {
      label: "contains",
      snippet: '${1:.field} contains ${2:"value"}',
      detail: "$(check) Substring / array element",
      doc: "Checks if string contains substring, or array contains element.",
      kind: vscode.CompletionItemKind.Operator,
    },
    {
      label: "matches",
      snippet: '${1:.field} matches ${2:"^regex$"}',
      detail: "$(check) Regex match",
      doc: "Right side is a regex pattern string.",
      kind: vscode.CompletionItemKind.Operator,
    },
    {
      label: "startsWith",
      snippet: '${1:.field} startsWith ${2:"prefix"}',
      detail: "$(check) String prefix",
      doc: "Returns true if the string starts with the given prefix.",
      kind: vscode.CompletionItemKind.Operator,
    },
    {
      label: "endsWith",
      snippet: '${1:.field} endsWith ${2:"suffix"}',
      detail: "$(check) String suffix",
      doc: "Returns true if the string ends with the given suffix.",
      kind: vscode.CompletionItemKind.Operator,
    },
    {
      label: "&& (AND)",
      snippet: '${1:.a} == ${2:"x"} && ${3:.b} == ${4:"y"}',
      detail: "$(check) Logical AND",
      doc: "Both sides must be true.",
      kind: vscode.CompletionItemKind.Operator,
    },
    {
      label: "|| (OR)",
      snippet: '${1:.a} == ${2:"x"} || ${3:.b} == ${4:"y"}',
      detail: "$(check) Logical OR",
      doc: "At least one side must be true.",
      kind: vscode.CompletionItemKind.Operator,
    },
    {
      label: "! (NOT)",
      snippet: "!${1:.field} == ${2:null}",
      detail: "$(check) Logical NOT",
      doc: "Negates the expression.",
      kind: vscode.CompletionItemKind.Operator,
    },
  ];

  const pluginSnippets: Array<{
    label: string;
    snippet: string;
    detail: string;
    doc: string;
  }> = [
    {
      label: "@uuid(path)",
      snippet: "@uuid(${1:.user.id})",
      detail: "$(shield) Validate UUID",
      doc: "Returns `true` for valid UUID v1–v8.",
    },
    {
      label: "@email(path)",
      snippet: "@email(${1:.user.email})",
      detail: "$(shield) Validate e-mail",
      doc: "Returns `true` for valid RFC 5322 e-mail.",
    },
    {
      label: "@ip(path)",
      snippet: "@ip(${1:.client_ip})",
      detail: "$(shield) Validate IP",
      doc: "Returns `true` for valid IPv4 or IPv6.",
    },
    {
      label: "@url(path)",
      snippet: "@url(${1:.profile.website})",
      detail: "$(shield) Validate URL",
      doc: "Returns `true` for valid URL.",
    },
    {
      label: "@timestamp(path)",
      snippet: "@timestamp(${1:.created_at})",
      detail: "$(shield) Validate timestamp",
      doc: "Returns `true` for valid timestamp (RFC 3339, ISO 8601, Unix).",
    },
    {
      label: "@regex(path, pattern)",
      snippet: '@regex(${1:.field}, ${2:"^pattern$"})',
      detail: "$(shield) Regex match",
      doc: "Returns `true` if value matches regex.",
    },
    {
      label: "@len(path)",
      snippet: "@len(${1:.items}) ${2:>} ${3:0}",
      detail: "$(symbol-numeric) Length",
      doc: "Returns length of string/array/object as integer.",
    },
    {
      label: "@empty(path)",
      snippet: "@empty(${1:.items})",
      detail: "$(symbol-numeric) Is empty?",
      doc: "`true` for null, empty string, empty array, empty object.",
    },
    {
      label: '@has_header("name")',
      snippet: '@has_header(${1:"x-request-id"})',
      detail: "$(symbol-variable) Header exists?",
      doc: "`true` if response contains the given header.",
    },
    {
      label: '@has_trailer("name")',
      snippet: '@has_trailer(${1:"grpc-status"})',
      detail: "$(symbol-variable) Trailer exists?",
      doc: "`true` if response contains the given trailer.",
    },
    {
      label: '@header("name")',
      snippet: '@header(${1:"x-request-id"})',
      detail: "$(symbol-variable) Get header value",
      doc: "Returns header string value, or `null`.",
    },
    {
      label: '@trailer("name")',
      snippet: '@trailer(${1:"x-checksum"})',
      detail: "$(symbol-variable) Get trailer value",
      doc: "Returns trailer string value, or `null`.",
    },
    {
      label: '@env("VAR")',
      snippet: '@env(${1:"VAR"})',
      detail: "$(symbol-variable) Environment variable",
      doc: 'Read env var. Optional default: `@env("VAR", "default")`.',
    },
    {
      label: "@elapsed_ms",
      snippet: "@elapsed_ms ${1:<} ${2:500}",
      detail: "$(clock) Elapsed time (ms)",
      doc: "Request elapsed time in milliseconds.",
    },
    {
      label: "@total_elapsed_ms",
      snippet: "@total_elapsed_ms ${1:<} ${2:5000}",
      detail: "$(clock) Total stream time (ms)",
      doc: "Total time for streaming response.",
    },
    {
      label: "@scope_message_count",
      snippet: "@scope_message_count ${2:==} ${3:3}",
      detail: "$(files) Messages in scope",
      doc: "Number of messages in current streaming scope.",
    },
    {
      label: "@scope_index",
      snippet: "@scope_index ${2:==} ${3:1}",
      detail: "$(files) Current message index",
      doc: "1-based index of current message.",
    },
  ];

  for (const [index, s] of snippets.entries()) {
    result.push(
      mk(s.label, s.kind, {
        insertText: new vscode.SnippetString(s.snippet),
        detail: s.detail,
        doc: s.doc,
        sortText: `b${String(index).padStart(2, "0")}`,
      }),
    );
  }

  for (const [index, p] of pluginSnippets.entries()) {
    result.push(
      mk(p.label, vscode.CompletionItemKind.Function, {
        insertText: new vscode.SnippetString(p.snippet),
        detail: p.detail,
        doc: p.doc,
        sortText: `c${String(index).padStart(2, "0")}`,
      }),
    );
  }

  return result;
}

function extractCompletionItems(
  document: vscode.TextDocument,
): vscode.CompletionItem[] {
  const result: vscode.CompletionItem[] = [];

  const requestVars = collectTemplateVarsFromRequest(document);
  for (const varName of requestVars) {
    result.push(
      mk(`${varName} = `, vscode.CompletionItemKind.Variable, {
        insertText: new vscode.SnippetString(`${varName} = \${1:.path}`),
        detail: "$(symbol-variable) Used in REQUEST",
        doc: `Define extraction for \`${varName}\` which is used as \`{{ ${varName} }}\` in REQUEST.`,
        sortText: "a00",
        filterText: varName,
      }),
    );
  }

  const jsonPaths = collectJsonPathPrefixes(document);
  if (jsonPaths.length > 0) {
    result.push(
      mk("var = .path", vscode.CompletionItemKind.Snippet, {
        insertText: new vscode.SnippetString(
          "${1:var_name} = ${2:.response.field}",
        ),
        detail: "JQ path extraction",
        doc: [
          "Extract a value using a JQ path expression.",
          "",
          "**Paths from this document:**",
          ...jsonPaths.slice(0, 8).map((p) => `- \`${p}\``),
        ].join("\n"),
        sortText: "b00",
      }),
    );
  }

  const templates: Array<{
    label: string;
    snippet: string;
    detail: string;
    doc: string;
  }> = [
    {
      label: "var = @header(...)",
      snippet: '${1:var} = @header(${2:"x-request-id"})',
      detail: "$(symbol-variable) Extract header",
      doc: "Store response header value in a variable.",
    },
    {
      label: "var = @trailer(...)",
      snippet: '${1:var} = @trailer(${2:"x-checksum"})',
      detail: "$(symbol-variable) Extract trailer",
      doc: "Store response trailer value in a variable.",
    },
    {
      label: "var = @env(...)",
      snippet: '${1:var} = @env(${2:"API_KEY"})',
      detail: "$(symbol-variable) Read env var",
      doc: "Store environment variable in a variable.",
    },
    {
      label: "var = @elapsed_ms",
      snippet: "${1:elapsed} = @elapsed_ms",
      detail: "$(clock) Elapsed time",
      doc: "Store request elapsed time in ms.",
    },
    {
      label: "var = .items | length",
      snippet: "${1:count} = ${2:.items} | length",
      detail: "$(symbol-numeric) JQ pipe",
      doc: "Use JQ pipes to transform values before storing.",
    },
  ];

  for (const [index, t] of templates.entries()) {
    result.push(
      mk(t.label, vscode.CompletionItemKind.Snippet, {
        insertText: new vscode.SnippetString(t.snippet),
        detail: t.detail,
        doc: t.doc,
        sortText: `b${String(index + 1).padStart(2, "0")}`,
      }),
    );
  }

  return result;
}

function requestHeadersCompletionItems(): vscode.CompletionItem[] {
  const items: Array<{ key: string; snippet: string; doc: string }> = [
    {
      key: "authorization",
      snippet: "authorization: ${1:Bearer token}",
      doc: "$(key) Authorization header",
    },
    {
      key: "x-request-id",
      snippet: "x-request-id: ${1:uuid-here}",
      doc: "$(file-symlink-file) Correlation ID",
    },
    {
      key: "x-api-key",
      snippet: "x-api-key: ${1:api-key}",
      doc: "$(key) API key header",
    },
    {
      key: "grpc-timeout",
      snippet: "grpc-timeout: ${1:10S}",
      doc: "$(clock) gRPC timeout (e.g. 10S, 500m)",
    },
  ];
  return items.map((e, index) =>
    mk(e.key, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(e.snippet),
      detail: e.doc,
      sortText: `0${String(index).padStart(2, "0")}`,
      commitCharacters: COMMIT_KEY,
    }),
  );
}

function protoKeyCompletionItems(): vscode.CompletionItem[] {
  const entries = [
    {
      key: "descriptor",
      snippet: "descriptor: ${1:./service.desc}",
      value: "./service.desc",
      doc: "$(file-code) Compiled descriptor set (.desc/.binpb)",
    },
    {
      key: "files",
      snippet: "files: ${1:./api.proto}",
      value: "./api.proto",
      doc: "$(file) Comma-separated .proto files",
    },
    {
      key: "import_paths",
      snippet: "import_paths: ${1:./protos}",
      value: "./protos",
      doc: "$(folder) Comma-separated import directories",
    },
  ];
  return entries.map((e, index) =>
    mk(`${e.key}: ${e.value}`, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(e.snippet),
      detail: e.doc,
      sortText: `0${String(index).padStart(2, "0")}`,
      commitCharacters: COMMIT_KEY,
    }),
  );
}

function tlsKeyCompletionItems(): vscode.CompletionItem[] {
  const entries = [
    {
      key: "ca_cert",
      snippet: "ca_cert: ${1:./ca.pem}",
      value: "./ca.pem",
      doc: "$(lock) CA cert (alias: ca_file)",
    },
    {
      key: "cert",
      snippet: "cert: ${1:./client.pem}",
      value: "./client.pem",
      doc: "$(lock) Client cert (aliases: client_cert, cert_file)",
    },
    {
      key: "key",
      snippet: "key: ${1:./client.key}",
      value: "./client.key",
      doc: "$(lock) Client key (aliases: client_key, key_file)",
    },
    {
      key: "server_name",
      snippet: "server_name: ${1:localhost}",
      value: "localhost",
      doc: "$(globe) TLS SNI override",
    },
    {
      key: "insecure",
      snippet: "insecure: ${1|true,false|}",
      value: "true",
      doc: "$(warning) Skip cert verification",
    },
  ];
  return entries.map((e, index) =>
    mk(`${e.key}: ${e.value}`, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(e.snippet),
      detail: e.doc,
      sortText: `0${String(index).padStart(2, "0")}`,
      commitCharacters: COMMIT_KEY,
    }),
  );
}

function optionsKeyCompletionItems(): vscode.CompletionItem[] {
  const entries = [
    {
      key: "timeout",
      snippet: "timeout: ${1:30}",
      value: "30",
      doc: "$(clock) Timeout in seconds",
    },
    {
      key: "retry",
      snippet: "retry: ${1:1}",
      value: "1",
      doc: "$(refresh) Retry count",
    },
    {
      key: "retry-delay",
      snippet: "retry-delay: ${1:1.0}",
      value: "1.0",
      doc: "$(clock) Delay between retries (alias: retry_delay)",
    },
    {
      key: "no-retry",
      snippet: "no-retry: ${1|true,false|}",
      value: "true",
      doc: "$(close) Disable retries (alias: no_retry)",
    },
    {
      key: "compression",
      snippet: "compression: ${1|none,gzip|}",
      value: "gzip",
      doc: "$(file-zip) Compression mode",
    },
  ];
  return entries.map((e, index) =>
    mk(`${e.key}: ${e.value}`, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(e.snippet),
      detail: e.doc,
      sortText: `0${String(index).padStart(2, "0")}`,
      commitCharacters: COMMIT_KEY,
    }),
  );
}

function sectionKeyCompletionItems(
  section: string | undefined,
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] {
  if (!section) return [];

  if (section === "META") {
    const valueItems = metaValueCompletionItems(document, position);
    if (valueItems.length > 0) return valueItems;
    const line = document.lineAt(position.line).text;
    if (line.trimEnd().endsWith(":"))
      return metaKeyCompletionItems(document, position);
    return metaKeyCompletionItems(document, position);
  }
  if (section === "REQUEST" || section === "RESPONSE") {
    return jsonBodyCompletionItems(section, document);
  }
  if (section === "ERROR") {
    return errorSectionCompletionItems(document, position);
  }
  if (section === "ASSERTS") {
    return assertsCompletionItems(document);
  }
  if (section === "EXTRACT") {
    return extractCompletionItems(document);
  }
  if (section === "REQUEST_HEADERS") {
    return requestHeadersCompletionItems();
  }
  if (section === "PROTO") {
    return protoKeyCompletionItems();
  }
  if (section === "TLS") {
    return tlsKeyCompletionItems();
  }
  if (section === "OPTIONS") {
    return optionsKeyCompletionItems();
  }
  return [];
}

function sectionHeaderOptionCompletionItems(
  section: string | undefined,
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] {
  if (section !== "RESPONSE" && section !== "ERROR") return [];

  const used = collectUsedInlineOptions(document, position);

  if (section === "ERROR") {
    if (used.has("with_asserts")) return [];
    return [
      mk("with_asserts", vscode.CompletionItemKind.Property, {
        insertText: "with_asserts",
        detail: "$(check) Run ASSERTS after error",
        doc: "Execute ASSERTS section after verifying the error response. `with_asserts` is equivalent to `with_asserts=true`.",
        sortText: "200",
      }),
      mk("with_asserts=true|false", vscode.CompletionItemKind.Property, {
        insertText: new vscode.SnippetString("with_asserts=${1|true,false|}"),
        detail: "$(check) Run ASSERTS toggle",
        doc: "Explicit boolean form: `with_asserts=true|false`.",
        sortText: "201",
      }),
    ];
  }

  const options: Array<{
    key: string;
    snippet: string;
    detail: string;
    doc: string;
  }> = [
    {
      key: "partial",
      snippet: "partial",
      detail: "$(diff) Subset matching",
      doc: "Only fields present in expected are checked. Extra fields in actual are ignored.",
    },
    {
      key: "with_asserts",
      snippet: "with_asserts",
      detail: "$(check) Run ASSERTS",
      doc: "Execute ASSERTS section after verifying response body. `with_asserts` is equivalent to `with_asserts=true`.",
    },
    {
      key: "with_asserts=true|false",
      snippet: "with_asserts=${1|true,false|}",
      detail: "$(check) Run ASSERTS toggle",
      doc: "Explicit boolean form: `with_asserts=true|false`.",
    },
    {
      key: "tolerance=0.001",
      snippet: "tolerance=${1:0.001}",
      detail: "$(symbol-numeric) Float tolerance",
      doc: "Numeric tolerance: `tolerance=0.01` means ±0.01 is equal.",
    },
    {
      key: "unordered_arrays",
      snippet: "unordered_arrays",
      detail: "$(sort) Ignore array order",
      doc: "Sort arrays before comparison for order-independent matching.",
    },
    {
      key: 'redact=["field"]',
      snippet: 'redact=[${1:"token"}]',
      detail: "$(eye-closed) Redact fields",
      doc: 'Remove sensitive fields. JSON array of field paths. Example: `redact=["token","password"]`.',
    },
  ];

  return options
    .filter((o) => !used.has(o.key))
    .map((o, index) =>
      mk(o.key, vscode.CompletionItemKind.Property, {
        insertText: new vscode.SnippetString(o.snippet),
        detail: o.detail,
        doc: o.doc,
        sortText: `2${String(index).padStart(2, "0")}`,
      }),
    );
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
    if (match) return match[1];
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
    if (!inAddress || text.length === 0 || text.startsWith("#")) continue;
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
    return cached.values.map(
      (value) =>
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
    const unique = Array.from(new Set(methods)).sort();
    endpointCompletionCache.set(address, {
      expiresAt: now + 30_000,
      values: unique,
    });

    return unique.map((value) => {
      const item = new vscode.CompletionItem(
        value,
        vscode.CompletionItemKind.Method,
      );
      item.detail = `$(globe) Reflected from ${address}`;
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
  const isPathKey =
    normalized.startsWith("descriptor:") ||
    normalized.startsWith("files:") ||
    normalized.startsWith("import_paths:");
  if (!isPathKey || document.uri.scheme !== "file") return [];

  return getPathCompletionsForExtension(document, /\.(proto|desc|binpb)$/i);
}

async function getTlsPathCompletions(
  document: vscode.TextDocument,
  currentLine: string,
): Promise<vscode.CompletionItem[]> {
  const normalized = currentLine.replace(/\s+/g, "");
  const tlsPathKeys = [
    "ca_cert:",
    "ca_file:",
    "cert:",
    "client_cert:",
    "cert_file:",
    "key:",
    "client_key:",
    "key_file:",
  ];
  const isPathKey = tlsPathKeys.some((k) => normalized.startsWith(k));
  if (!isPathKey || document.uri.scheme !== "file") return [];

  return getPathCompletionsForExtension(document, /\.(pem|crt|cer|key|p12)$/i);
}

async function getPathCompletionsForExtension(
  document: vscode.TextDocument,
  extPattern: RegExp,
): Promise<vscode.CompletionItem[]> {
  const workspaceRoot =
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
    path.dirname(document.uri.fsPath);
  const baseDir = path.dirname(document.uri.fsPath);

  const extGlob = buildGlobFromPattern(extPattern);
  const workspaceUris = await vscode.workspace.findFiles(
    extGlob,
    "**/node_modules/**",
    200,
  );

  const filesFromWorkspace = workspaceUris
    .map((uri) => uri.fsPath)
    .filter((fsPath) => fsPath.startsWith(workspaceRoot));

  const filesFromLocalTree: string[] = [];
  if (filesFromWorkspace.length === 0) {
    const queue: Array<{ dir: string; depth: number }> = [
      { dir: baseDir, depth: 0 },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.depth > 3) continue;
      try {
        const entries = await readdir(current.dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules")
            continue;
          const fullPath = path.join(current.dir, entry.name);
          if (entry.isDirectory()) {
            queue.push({ dir: fullPath, depth: current.depth + 1 });
            continue;
          }
          if (extPattern.test(entry.name)) {
            filesFromLocalTree.push(fullPath);
          }
        }
      } catch {
        // per-directory read errors
      }
    }
  }

  return [...filesFromWorkspace, ...filesFromLocalTree]
    .map((fsPath) => path.relative(baseDir, fsPath))
    .filter((rel) => rel.length > 0)
    .sort()
    .map((rel) =>
      mk(`"${rel}"`, vscode.CompletionItemKind.File, {
        insertText: new vscode.SnippetString(`"${rel}"`),
        detail: "$(file) Relative to .gctf",
        sortText: rel,
      }),
    );
}

function buildGlobFromPattern(extPattern: RegExp): string {
  const source = extPattern.source;
  const altMatch = source.match(/\(([^)]+)\)/);
  if (altMatch?.[1]) {
    const exts = altMatch[1].split("|").map((e) => e.replace(/\\\./g, "."));
    return `**/*.{${exts.join(",")}}`;
  }
  return "**/*.*";
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

        const isSectionHeaderPrefix = /^---\s*[A-Z_]*$/.test(linePrefix);
        const isBlankHeaderLine =  /^\s*-*$/.test(linePrefixRaw) && !currentSection;
        if (isSectionHeaderPrefix || isBlankHeaderLine) {
          return sectionCompletionItems(replaceRange);
        }

        if (isCursorOnSectionHeader(document, position)) {
          const headerOptions = sectionHeaderOptionCompletionItems(
            currentSection,
            document,
            position,
          );
          if (headerOptions.length > 0) return headerOptions;
        }

        if (currentSection === "ENDPOINT") {
          if (dependencies.isLspRunning()) return [];

          const address = extractAddress(document);
          const reflected = address
            ? await getEndpointCompletionsFromReflection(address)
            : [];
          const fallback = mk(
            "package.Service/Method",
            vscode.CompletionItemKind.Snippet,
            {
              insertText: new vscode.SnippetString(
                "${1:package}.${2:Service}/${3:Method}",
              ),
              detail: "$(symbol-method) Endpoint template",
              doc: "gRPC method path: `package.Service/Method`",
              sortText: "0000",
            },
          );
          return [fallback, ...reflected];
        }

        if (currentSection === "PROTO") {
          const protoPaths = await getProtoPathCompletions(
            document,
            currentLine,
          );
          if (protoPaths.length > 0) return protoPaths;
        }

        if (currentSection === "TLS") {
          const tlsPaths = await getTlsPathCompletions(document, currentLine);
          if (tlsPaths.length > 0) return tlsPaths;
        }

        return sectionKeyCompletionItems(currentSection, document, position);
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
    if (
      !editor ||
      editor.document.uri.toString() !== event.document.uri.toString()
    )
      return;
    if (event.document.languageId !== "grpctestify") return;
    if (event.contentChanges.length !== 1) return;
    const change = event.contentChanges[0];
    if (
      !change ||
      change.text.length !== 1 ||
      !autoSuggestTriggers.has(change.text)
    )
      return;

    void vscode.commands.executeCommand("editor.action.triggerSuggest");
  });
  context.subscriptions.push(autoSuggest);
}
