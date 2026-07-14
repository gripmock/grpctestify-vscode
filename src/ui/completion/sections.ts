import * as vscode from "vscode";

import { GRPC_STATUS_ENTRIES, COMMON_TAGS, COMMIT_KEY, COMMIT_YAML } from "./constants";
import { collectUsedMetaKeys, collectUsedInlineOptions } from "./collectors";

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
  item.insertText = opts.insertText;
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

function grpcErrorCodeItems(): vscode.CompletionItem[] {
  return GRPC_STATUS_ENTRIES.map(([code, name, desc], idx) =>
    mk(`"${code}"`, vscode.CompletionItemKind.EnumMember, {
      insertText: `"\\${code}"`,
      detail: `${name}: ${desc}`,
      sortText: `0${String(idx).padStart(2, "0")}`,
    }),
  );
}

export function sectionCompletionItems(replaceRange: vscode.Range): vscode.CompletionItem[] {
  const sections: Array<{
    label: string; snippet: string; detail: string; doc: string;
  }> = [
    { label: "META", snippet: "--- META ---\n", detail: "$(tag) Test metadata", doc: "YAML front-matter: `name`, `summary`, `tags`, `owner`, `links`. Must be first section." },
    { label: "ADDRESS", snippet: "--- ADDRESS ---\n", detail: "$(globe) Server address", doc: "`host:port` of the gRPC server. Exactly one per document." },
    { label: "ENDPOINT", snippet: "--- ENDPOINT ---\n", detail: "$(symbol-method) RPC method", doc: "`package.Service/Method`. Resolved via reflection or PROTO." },
    { label: "REQUEST", snippet: "--- REQUEST ---\n", detail: "$(arrow-right) Request body", doc: "JSON5 body (trailing commas, `//` comments, `{{var}}` templates)." },
    { label: "RESPONSE", snippet: "--- RESPONSE ---\n", detail: "$(arrow-left) Expected response", doc: "Expected JSON body." },
    { label: "RESPONSE partial", snippet: "--- RESPONSE partial tolerance=0.001 ---\n", detail: "$(arrow-left) Partial response", doc: "Subset matching with numeric tolerance." },
    { label: "ERROR", snippet: "--- ERROR ---\n", detail: "$(error) Expected error", doc: "Expected gRPC error." },
    { label: "REQUEST_HEADERS", snippet: "--- REQUEST_HEADERS ---\n", detail: "$(file-symlink-file) Custom headers", doc: "One `key: value` pair per line." },
    { label: "ASSERTS", snippet: "--- ASSERTS ---\n", detail: "$(check) Assertions", doc: "Boolean expressions with operators, plugins, and JQ paths." },
    { label: "EXTRACT", snippet: "--- EXTRACT ---\n", detail: "$(symbol-variable) Extract variables", doc: "`var = .jq.path`. Available as `{{var}}` in REQUEST." },
    { label: "TLS", snippet: "--- TLS ---\n", detail: "$(lock) TLS / mTLS", doc: "`ca_cert`, `cert`, `key`, `server_name`, `insecure`." },
    { label: "PROTO", snippet: "--- PROTO ---\n", detail: "$(file-code) Proto source", doc: "`descriptor` (compiled) or `files` + `import_paths` (source)." },
    { label: "OPTIONS", snippet: "--- OPTIONS ---\n", detail: "$(settings-gear) Request options", doc: "`timeout`, `retry`, `retry-delay`, `no-retry`, `compression`, `protocol`." },
    { label: "BENCH", snippet: "--- BENCH ---\n", detail: "$(dashboard) Benchmark config", doc: "Benchmark configuration: profile, concurrency, duration." },
  ];

  return sections.map((section, index) => {
    const displayLabel = section.label.startsWith("RESPONSE partial")
      ? "--- RESPONSE partial tolerance=0.001 ---"
      : `--- ${section.label} ---`;
    return mk(displayLabel, vscode.CompletionItemKind.Snippet, {
      insertText: new vscode.SnippetString(section.snippet),
      detail: section.detail,
      doc: section.doc,
      sortText: `0${String(index).padStart(2, "0")}`,
    });
  }).map((item) => { item.range = replaceRange; return item; });
}

export function metaKeyCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const keys = [
    { key: "name", snippet: "name: ${1:test name}", value: "${1:test name}", doc: "$(symbol-key) Human-readable test name" },
    { key: "summary", snippet: "summary: ${1:Test description}", value: "${1:Test description}", doc: "$(symbol-key) One-line test description" },
    { key: "tags", snippet: "tags: [${1:smoke}, ${2:regression}]", value: "[${1:smoke}, ${2:regression}]", doc: "$(filter) Filter tags" },
    { key: "owner", snippet: "owner: ${1:team-name}", value: "${1:team-name}", doc: "$(person) Responsible team" },
    { key: "links", snippet: "links:\n  - ${1:https://example.com}", value: "${1:https://example.com}", doc: "$(link) Related URLs" },
  ];
  const used = collectUsedMetaKeys(document, position.line);
  return keys.filter((k) => !used.has(k.key)).map((e) =>
    mk(e.key, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(e.snippet),
      detail: e.doc,
      sortText: `0${String(keys.indexOf(e)).padStart(2, "0")}`,
      commitCharacters: COMMIT_YAML,
    }),
  );
}

export function metaValueCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const line = document.lineAt(position.line).text;
  const keyMatch = line.match(/^\s*(\w+)\s*:/);
  const key = keyMatch?.[1];
  if (key !== "tags") return [];
  return COMMON_TAGS.map((tag) =>
    mk(tag, vscode.CompletionItemKind.Value, {
      insertText: tag,
      detail: "$(tag) Common tag",
      sortText: "100",
    }),
  );
}

export function errorSectionCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const line = document.lineAt(position.line).text.trim();
  const jsonKeyMatch = line.match(/^\s*"(\w+)"\s*:/);
  if (jsonKeyMatch) {
    if (jsonKeyMatch[1] === "code") return grpcErrorCodeItems();
    return [];
  }
  const isEmpty = line === "" || line === "{" || line === "//" || line.startsWith("#");
  if (!isEmpty) return [];
  return [
    mk("gRPC error with code", vscode.CompletionItemKind.Snippet, {
      insertText: new vscode.SnippetString([
        "{",
        '  "code": ${1:5},',
        '  "message": "${2:entity not found}"',
        "}",
      ].join("\n")),
      detail: "$(error) Error object with code and message",
      sortText: "000",
    }),
    mk("gRPC error as string", vscode.CompletionItemKind.Snippet, {
      insertText: new vscode.SnippetString('"${1:not found}"'),
      detail: "$(error) Error message as plain string",
      sortText: "001",
    }),
  ];
}

export function sectionHeaderOptionCompletionItems(section: string | undefined, document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  if (section !== "RESPONSE" && section !== "ERROR") return [];
  const used = collectUsedInlineOptions(document, position);
  if (section === "ERROR") {
    if (used.has("with_asserts")) return [];
    return [
      mk("with_asserts", vscode.CompletionItemKind.Property, {
        insertText: "with_asserts",
        detail: "$(check) Run ASSERTS after error",
        doc: "Execute ASSERTS section after verifying the error response.",
        sortText: "200",
      }),
      mk("with_asserts=true|false", vscode.CompletionItemKind.Property, {
        insertText: new vscode.SnippetString("with_asserts=${1|true,false|}"),
        detail: "$(check) Run ASSERTS toggle",
        sortText: "201",
      }),
    ];
  }
  const options: Array<{ label: string; snippet: string; detail: string; doc: string; }> = [
    { label: "with_asserts", snippet: "with_asserts", detail: "$(check) Run ASSERTS after response", doc: "" },
    { label: "with_asserts=true|false", snippet: "with_asserts=${1|true,false|}", detail: "$(check) Run ASSERTS toggle", doc: "" },
    { label: "partial", snippet: "partial", detail: "$(filter) Subset match", doc: "" },
    { label: "partial=true|false", snippet: "partial=${1|true,false|}", detail: "$(filter) Subset match toggle", doc: "" },
    { label: "tolerance=N", snippet: "tolerance=${1:0.01}", detail: "$(symbol-numeric) Numeric tolerance", doc: "" },
    { label: "unordered_arrays", snippet: "unordered_arrays", detail: "$(array) Ignore array order", doc: "" },
    { label: "redact=[...]", snippet: 'redact=["${1:pw}"]', detail: "$(mask) Redact sensitive fields", doc: "" },
  ];
  return options.filter((o) => !used.has(o.label.split("=")[0] ?? o.label)).map((e, idx) =>
    mk(e.label, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(e.snippet),
      detail: e.detail,
      sortText: `2${String(idx).padStart(2, "0")}`,
    }),
  );
}

export function optionsKeyCompletionItems(): vscode.CompletionItem[] {
  const entries = [
    { key: "timeout", snippet: "timeout: ${1:30}", value: "30", doc: "$(clock) Timeout in seconds" },
    { key: "retry", snippet: "retry: ${1:1}", value: "1", doc: "$(refresh) Retry count" },
    { key: "retry-delay", snippet: "retry-delay: ${1:1.0}", value: "1.0", doc: "$(clock) Delay between retries" },
    { key: "no-retry", snippet: "no-retry: ${1|true,false|}", value: "true", doc: "$(close) Disable retries" },
    { key: "compression", snippet: "compression: ${1|none,gzip|}", value: "gzip", doc: "$(file-zip) Compression mode" },
    { key: "protocol", snippet: "protocol: ${1|grpc,grpc-web,connectrpc|}", value: "grpc", doc: "$(symbol-parameter) gRPC protocol" },
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

export function benchKeyCompletionItems(): vscode.CompletionItem[] {
  const entries = [
    { key: "profile", snippet: "profile: ${1|functional,load,stress,spike,soak|}", value: "functional", doc: "$(dashboard) Benchmark profile" },
    { key: "mode", snippet: "mode: ${1|warmup,dry_run|}", value: "warmup", doc: "$(play) Execution mode" },
    { key: "concurrency", snippet: "concurrency: ${1:10}", value: "10", doc: "$(organization) Concurrent workers" },
    { key: "requests", snippet: "requests: ${1:1000}", value: "1000", doc: "$(list-flat) Total requests" },
    { key: "duration", snippet: "duration: ${1:30}", value: "30", doc: "$(clock) Duration in seconds" },
    { key: "ramp_up", snippet: "ramp_up: ${1:5}", value: "5", doc: "$(graph) Ramp-up in seconds" },
    { key: "warmup", snippet: "warmup: ${1:5}", value: "5", doc: "$(play) Warmup period" },
    { key: "max_duration", snippet: "max_duration: ${1:300}", value: "300", doc: "$(clock) Max duration" },
    { key: "max_rps", snippet: "max_rps: ${1:100}", value: "100", doc: "$(rocket) Max RPS" },
    { key: "connections", snippet: "connections: ${1:10}", value: "10", doc: "$(plug) gRPC connections" },
    { key: "load_schedule", snippet: "load_schedule: ${1|linear,incremental,random|}", value: "linear", doc: "$(graph) Load schedule" },
    { key: "sample_rate", snippet: "sample_rate: ${1:1.0}", value: "1.0", doc: "$(percentage) Sample rate" },
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

export function protoKeyCompletionItems(): vscode.CompletionItem[] {
  const entries = [
    { key: "descriptor", snippet: "descriptor: ${1:./proto/api.desc}", value: "./proto/api.desc", doc: "$(file-binary) Compiled descriptor set" },
    { key: "files", snippet: "files: ${1:./proto/api.proto}", value: "./proto/api.proto", doc: "$(file-code) Proto source files (comma-separated)" },
    { key: "import_paths", snippet: "import_paths: ${1:./proto}", value: "./proto", doc: "$(folder-opened) Import search directories" },
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

export function tlsKeyCompletionItems(): vscode.CompletionItem[] {
  const entries = [
    { key: "ca_cert", snippet: "ca_cert: ${1:./certs/ca.pem}", value: "./certs/ca.pem", doc: "$(lock) CA certificate" },
    { key: "cert", snippet: "cert: ${1:./certs/client.pem}", value: "./certs/client.pem", doc: "$(lock) Client certificate" },
    { key: "key", snippet: "key: ${1:./certs/client.key}", value: "./certs/client.key", doc: "$(lock) Client key" },
    { key: "server_name", snippet: "server_name: ${1:localhost}", value: "localhost", doc: "$(globe) TLS SNI override" },
    { key: "insecure", snippet: "insecure: ${1|true,false|}", value: "true", doc: "$(warning) Skip cert verification" },
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

export function requestHeadersCompletionItems(): vscode.CompletionItem[] {
  const headers = [
    ["authorization", "Bearer ${1:token}"],
    ["content-type", "application/grpc"],
    ["x-request-id", "${1:uuid}"],
    ["x-api-key", "${1:key}"],
    ["user-agent", "grpctestify"],
    ["grpc-timeout", "${1:5}S"],
    ["x-forwarded-for", "${1:ip}"],
  ];
  return headers.map(([key, val], idx) =>
    mk(`${key}: ${val}`, vscode.CompletionItemKind.Property, {
      insertText: new vscode.SnippetString(`${key}: ${val}`),
      detail: "$(file-symlink-file) Common header",
      sortText: `0${String(idx).padStart(2, "0")}`,
      commitCharacters: COMMIT_KEY,
    }),
  );
}

export function sectionKeyCompletionItems(section: string | undefined, document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  if (!section) return [];
  if (section === "META") {
    const valueItems = metaValueCompletionItems(document, position);
    if (valueItems.length > 0) return valueItems;
    return metaKeyCompletionItems(document, position);
  }
  if (section === "ERROR") {
    return errorSectionCompletionItems(document, position);
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
  if (section === "BENCH") {
    return benchKeyCompletionItems();
  }
  return [];
}
