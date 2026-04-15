import * as vscode from "vscode";

interface PluginInfo {
  signature: string;
  short: string;
  doc: string;
  example: string;
  exampleResult?: string;
  sections: string[];
  returns: string;
}

const PLUGINS: Record<string, PluginInfo> = {
  "@uuid": {
    signature: "@uuid(path)",
    short: "Validate UUID format",
    doc: "Returns `true` if the value is a valid UUID (v1–v8).",
    example: "@uuid(.user.id)",
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@email": {
    signature: "@email(path)",
    short: "Validate e-mail format",
    doc: "Returns `true` if the value matches RFC 5322 e-mail format.",
    example: "@email(.user.email)",
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@ip": {
    signature: "@ip(path)",
    short: "Validate IP address",
    doc: "Returns `true` if the value is a valid IPv4 or IPv6 address.",
    example: "@ip(.client_ip)",
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@url": {
    signature: "@url(path)",
    short: "Validate URL format",
    doc: "Returns `true` if the value is a valid URL.",
    example: "@url(.profile.website)",
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@timestamp": {
    signature: "@timestamp(path)",
    short: "Validate timestamp",
    doc: "Returns `true` if the value looks like a valid timestamp (RFC 3339, Unix epoch, ISO 8601).",
    example: "@timestamp(.created_at)",
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@regex": {
    signature: "@regex(path, pattern)",
    short: "Regex match",
    doc: "Returns `true` if the value matches the given regex pattern.",
    example: '@regex(.code, "^ERR-[0-9]+$")',
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@len": {
    signature: "@len(path)",
    short: "Get length",
    doc: "Returns the length of a string, array, or object as a non-negative integer.",
    example: "@len(.items) > 0",
    exampleResult: "3",
    sections: ["ASSERTS"],
    returns: "uint",
  },
  "@empty": {
    signature: "@empty(path)",
    short: "Check emptiness",
    doc: "Returns `true` if the value is `null`, an empty string, empty array, or empty object.",
    example: "@empty(.items)",
    exampleResult: "false",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@has_header": {
    signature: "@has_header(name)",
    short: "Check response header",
    doc: "Returns `true` if the gRPC response contains the given header.",
    example: '@has_header("x-request-id")',
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@has_trailer": {
    signature: "@has_trailer(name)",
    short: "Check response trailer",
    doc: "Returns `true` if the gRPC response contains the given trailer.",
    example: '@has_trailer("grpc-status")',
    exampleResult: "true",
    sections: ["ASSERTS"],
    returns: "bool",
  },
  "@header": {
    signature: "@header(name)",
    short: "Extract response header",
    doc: "Returns the value of the given response header, or `null` if absent.",
    example: '@header("x-request-id")',
    exampleResult: '"abc-123"',
    sections: ["ASSERTS", "EXTRACT"],
    returns: "string | null",
  },
  "@trailer": {
    signature: "@trailer(name)",
    short: "Extract response trailer",
    doc: "Returns the value of the given response trailer, or `null` if absent.",
    example: '@trailer("x-checksum")',
    exampleResult: '"sha256:..."',
    sections: ["ASSERTS", "EXTRACT"],
    returns: "string | null",
  },
  "@env": {
    signature: "@env(name, default?)",
    short: "Read environment variable",
    doc: "Returns the value of the environment variable, or `default` if unset, or `null`.",
    example: '@env("API_KEY", "dev-key")',
    exampleResult: '"dev-key"',
    sections: ["ASSERTS", "EXTRACT"],
    returns: "string | null",
  },
  "@elapsed_ms": {
    signature: "@elapsed_ms",
    short: "Request elapsed time",
    doc: "Elapsed wall-clock time for the current request in milliseconds.",
    example: "@elapsed_ms < 500",
    exampleResult: "142",
    sections: ["ASSERTS", "EXTRACT"],
    returns: "uint",
  },
  "@total_elapsed_ms": {
    signature: "@total_elapsed_ms",
    short: "Total stream elapsed time",
    doc: "Total elapsed time across all messages in a streaming response, in milliseconds.",
    example: "@total_elapsed_ms < 5000",
    exampleResult: "2341",
    sections: ["ASSERTS", "EXTRACT"],
    returns: "uint",
  },
  "@scope_message_count": {
    signature: "@scope_message_count",
    short: "Messages in current scope",
    doc: "Number of messages received so far in the current streaming scope.",
    example: "@scope_message_count == 3",
    exampleResult: "3",
    sections: ["ASSERTS"],
    returns: "uint",
  },
  "@scope_index": {
    signature: "@scope_index",
    short: "Current message index",
    doc: "1-based index of the current message within its streaming scope.",
    example: "@scope_index == 1",
    exampleResult: "1",
    sections: ["ASSERTS"],
    returns: "uint",
  },
};

const OPERATORS: Record<
  string,
  { doc: string; example: string; kind: string }
> = {
  "==": {
    doc: "Equality. Works for strings, numbers, booleans, and null.",
    example: '.status == "ok"',
    kind: "comparison",
  },
  "!=": {
    doc: "Inequality. Negation of `==`.",
    example: '.status != "error"',
    kind: "comparison",
  },
  ">": {
    doc: "Greater than. For numbers only.",
    example: "@len(.items) > 0",
    kind: "comparison",
  },
  "<": {
    doc: "Less than. For numbers only.",
    example: "@elapsed_ms < 500",
    kind: "comparison",
  },
  ">=": {
    doc: "Greater than or equal. For numbers only.",
    example: ".score >= 0.8",
    kind: "comparison",
  },
  "<=": {
    doc: "Less than or equal. For numbers only.",
    example: ".count <= 10",
    kind: "comparison",
  },
  contains: {
    doc: "Substring or array-element containment check.",
    example: '.message contains "hello"',
    kind: "string/array",
  },
  matches: {
    doc: "Regex match. Right-hand side is a pattern string.",
    example: '.email matches "^[a-z]+@"',
    kind: "string",
  },
  startsWith: {
    doc: "Returns `true` if the string starts with the given prefix.",
    example: '.id startsWith "user-"',
    kind: "string",
  },
  endsWith: {
    doc: "Returns `true` if the string ends with the given suffix.",
    example: '.file endsWith ".proto"',
    kind: "string",
  },
};

const SECTIONS: Record<
  string,
  {
    icon: string;
    doc: string;
    multiline: boolean;
    repeatable: boolean;
    bodyFormat: string;
  }
> = {
  META: {
    icon: "$(tag)",
    doc: "Test metadata — name, summary, tags, owner, and links.\n\nMust be the **first** section if present. Maximum one per document.",
    multiline: true,
    repeatable: false,
    bodyFormat: "YAML",
  },
  ADDRESS: {
    icon: "$(globe)",
    doc: "Target gRPC server address in `host:port` format.\n\nExactly one per document. Use `https://` prefix to enforce TLS.",
    multiline: false,
    repeatable: false,
    bodyFormat: "`host:port`",
  },
  ENDPOINT: {
    icon: "$(symbol-method)",
    doc: "Full gRPC method path: `package.Service/Method`.\n\nExactly one per test document. The method is resolved via server reflection or a PROTO section.",
    multiline: false,
    repeatable: false,
    bodyFormat: "`package.Service/Method`",
  },
  REQUEST: {
    icon: "$(arrow-right)",
    doc: "JSON request body sent to the server.\n\nSupports JSON5 syntax (trailing commas, unquoted keys, `//` comments). Use `{{var}}` to inject values from EXTRACT.",
    multiline: true,
    repeatable: true,
    bodyFormat: "JSON5",
  },
  RESPONSE: {
    icon: "$(arrow-left)",
    doc: "Expected JSON response body.\n\nInline options modify matching behaviour. For streaming, use newline-delimited JSON (one object per message).",
    multiline: true,
    repeatable: true,
    bodyFormat: "JSON5",
  },
  ERROR: {
    icon: "$(error)",
    doc: "Expected gRPC error.\n\nAccepts a simple string (substring match) or an object `{ code, message, details }`. Use `with_asserts` to also run assertions.",
    multiline: true,
    repeatable: false,
    bodyFormat: "JSON5 or string",
  },
  REQUEST_HEADERS: {
    icon: "$(file-symlink-file)",
    doc: "Custom metadata headers for the gRPC call.\n\nOne `key: value` pair per line.",
    multiline: true,
    repeatable: false,
    bodyFormat: "`key: value` per line",
  },
  ASSERTS: {
    icon: "$(check)",
    doc: "Boolean expressions evaluated against the response.\n\nSupports `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `matches`, `startsWith`, `endsWith`, logical `&&`/`||`/`!`, and plugins like `@uuid()`, `@len()`.",
    multiline: true,
    repeatable: true,
    bodyFormat: "Assertion DSL",
  },
  EXTRACT: {
    icon: "$(symbol-variable)",
    doc: "Extract values from the response into named variables.\n\nUse `var_name = .jq.path`. Variables are available in subsequent REQUEST bodies as `{{var_name}}`.",
    multiline: true,
    repeatable: true,
    bodyFormat: "`name = expression`",
  },
  TLS: {
    icon: "$(lock)",
    doc: "TLS/mTLS configuration.\n\nCanonical keys: `ca_cert`, `cert`, `key`, `server_name`, `insecure`. Aliases are accepted.",
    multiline: true,
    repeatable: false,
    bodyFormat: "`key: value` per line",
  },
  PROTO: {
    icon: "$(file-code)",
    doc: "Protobuf schema source — use instead of server reflection.\n\nProvide `descriptor` (compiled) or `files` + `import_paths` (source).",
    multiline: true,
    repeatable: false,
    bodyFormat: "`key: value` per line",
  },
  OPTIONS: {
    icon: "$(settings-gear)",
    doc: "Per-request options: timeout, retries, and compression.\n\nThese override defaults from the CLI flags and config file.",
    multiline: true,
    repeatable: false,
    bodyFormat: "`key: value` per line",
  },
};

const KEY_DOCS: Record<
  string,
  {
    section: string;
    type: string;
    doc: string;
    example: string;
    aliases?: string[];
  }
> = {
  name: {
    section: "META",
    type: "string",
    doc: "Human-readable test name. Shown in test output and reports.",
    example: "name: Create user and verify response",
  },
  summary: {
    section: "META",
    type: "string",
    doc: "One-line description of what this test validates.",
    example: "summary: Happy-path for unary CreateUser RPC",
  },
  tags: {
    section: "META",
    type: "string[]",
    doc: "Tags for filtering. Use with `--tags smoke` or `--skip-tags flaky`.",
    example: "tags: [smoke, regression]",
  },
  owner: {
    section: "META",
    type: "string",
    doc: "Team or individual responsible for this test.",
    example: "owner: backend-team",
  },
  links: {
    section: "META",
    type: "string[]",
    doc: "Related URLs: design docs, JIRA tickets, API specs.",
    example: "links:\n  - https://jira.example.com/TASK-123",
  },
  descriptor: {
    section: "PROTO",
    type: "path",
    doc: "Compiled protobuf descriptor set (`.desc` or `.binpb`). Generated by `protoc --descriptor_set_out`.",
    example: "descriptor: ./proto/api.desc",
  },
  files: {
    section: "PROTO",
    type: "path[]",
    doc: "Comma-separated `.proto` source files. Used when no descriptor is available.",
    example: "files: ./proto/api.proto, ./proto/types.proto",
  },
  import_paths: {
    section: "PROTO",
    type: "path[]",
    doc: "Comma-separated import search directories for proto resolution.",
    example: "import_paths: ./proto, ./third_party",
  },
  ca_cert: {
    section: "TLS",
    type: "path",
    doc: "CA certificate for server verification.",
    example: "ca_cert: ./certs/ca.pem",
    aliases: ["ca_file"],
  },
  cert: {
    section: "TLS",
    type: "path",
    doc: "Client certificate for mutual TLS.",
    example: "cert: ./certs/client.pem",
    aliases: ["client_cert", "cert_file"],
  },
  key: {
    section: "TLS",
    type: "path",
    doc: "Client private key for mutual TLS.",
    example: "key: ./certs/client.key",
    aliases: ["client_key", "key_file"],
  },
  server_name: {
    section: "TLS",
    type: "string",
    doc: "Override TLS SNI server name. Useful when connecting via IP.",
    example: "server_name: my-service.internal",
  },
  insecure: {
    section: "TLS",
    type: "bool",
    doc: "Skip certificate verification. **Do not use in production.**",
    example: "insecure: true",
  },
  timeout: {
    section: "OPTIONS",
    type: "uint",
    doc: "Request timeout in seconds. Overrides the CLI `--timeout` flag.",
    example: "timeout: 30",
  },
  retry: {
    section: "OPTIONS",
    type: "uint",
    doc: "Number of automatic retries for transient failures.",
    example: "retry: 3",
  },
  "retry-delay": {
    section: "OPTIONS",
    type: "float",
    doc: "Delay between retry attempts, in seconds.",
    example: "retry-delay: 1.5",
    aliases: ["retry_delay"],
  },
  "no-retry": {
    section: "OPTIONS",
    type: "bool",
    doc: "Completely disable retry logic for this request.",
    example: "no-retry: true",
    aliases: ["no_retry"],
  },
  compression: {
    section: "OPTIONS",
    type: '"none" | "gzip"',
    doc: "Compression algorithm for the gRPC call.",
    example: "compression: gzip",
  },
};

const INLINE_OPTION_DOCS: Record<
  string,
  { appliesTo: string[]; doc: string; example: string }
> = {
  partial: {
    appliesTo: ["RESPONSE"],
    doc: "Subset matching — only fields present in the expected body are checked. Extra fields in the actual response are ignored.",
    example: "--- RESPONSE partial ---",
  },
  with_asserts: {
    appliesTo: ["RESPONSE", "ERROR"],
    doc: "Run the ASSERTS section after verifying the body/error. Without this, ASSERTS only runs when there is no explicit RESPONSE/ERROR. `with_asserts` is equivalent to `with_asserts=true`.",
    example: "--- RESPONSE with_asserts ---",
  },
  tolerance: {
    appliesTo: ["RESPONSE"],
    doc: "Numeric tolerance for floating-point comparisons.\n\n`tolerance=0.01` means values within ±0.01 are considered equal.",
    example: "--- RESPONSE partial tolerance=0.01 ---",
  },
  unordered_arrays: {
    appliesTo: ["RESPONSE"],
    doc: "Ignore element order in arrays during comparison. Both arrays are sorted before matching.",
    example: "--- RESPONSE unordered_arrays ---",
  },
  redact: {
    appliesTo: ["RESPONSE"],
    doc: "Remove sensitive fields before comparison. Pass a JSON array of field names.",
    example: '--- RESPONSE redact=["token","password"] ---',
  },
};

const GRPC_STATUS: Record<number, [string, string]> = {
  0: ["OK", "Success"],
  1: ["CANCELLED", "Operation cancelled by caller"],
  2: ["UNKNOWN", "Unknown or unclassifiable error"],
  3: ["INVALID_ARGUMENT", "Client specified an invalid argument"],
  4: ["DEADLINE_EXCEEDED", "Operation expired before completion"],
  5: ["NOT_FOUND", "Requested resource was not found"],
  6: ["ALREADY_EXISTS", "Resource already exists"],
  7: ["PERMISSION_DENIED", "Caller lacks permission"],
  8: ["RESOURCE_EXHAUSTED", "Quota or resource limit exceeded"],
  9: [
    "FAILED_PRECONDITION",
    "System not in a state required for the operation",
  ],
  10: ["ABORTED", "Operation aborted due to concurrency conflict"],
  11: ["OUT_OF_RANGE", "Value out of valid range"],
  12: ["UNIMPLEMENTED", "Method not implemented by the server"],
  13: ["INTERNAL", "Internal server error"],
  14: ["UNAVAILABLE", "Service is currently unreachable"],
  15: ["DATA_LOSS", "Unrecoverable data loss or corruption"],
  16: ["UNAUTHENTICATED", "Request lacks valid authentication credentials"],
};

function md(...lines: string[]): vscode.MarkdownString {
  return new vscode.MarkdownString(lines.join("\n\n"));
}

export function registerHoverProvider(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerHoverProvider("grpctestify", {
    provideHover(document, position) {
      const line = document.lineAt(position.line).text;
      const trimmed = line.trim();

      const sectionRange = trySectionHover(trimmed, line, position);
      if (sectionRange) return sectionRange;

      const pluginRange = tryPluginHover(document, position);
      if (pluginRange) return pluginRange;

      const keyHover = tryKeyHover(line, position);
      if (keyHover) return keyHover;

      const inlineOptionHover = tryInlineOptionHover(trimmed);
      if (inlineOptionHover) return inlineOptionHover;

      const templateHover = tryTemplateHover(line, position);
      if (templateHover) return templateHover;

      const operatorHover = tryOperatorHover(document, position);
      if (operatorHover) return operatorHover;

      const statusCodeHover = tryStatusCodeHover(trimmed);
      if (statusCodeHover) return statusCodeHover;

      return undefined;
    },
  });

  context.subscriptions.push(provider);
}

function trySectionHover(
  trimmed: string,
  line: string,
  position: vscode.Position,
): vscode.Hover | undefined {
  const sectionMatch = trimmed.match(/^---\s+([A-Z_]+)\b/);
  if (!sectionMatch?.[1]) return undefined;
  const name = sectionMatch[1];
  const info = SECTIONS[name];
  if (!info) return undefined;

  const headerStart = line.indexOf("---");
  const headerEnd = line.lastIndexOf("---") + 3;
  const range = new vscode.Range(
    position.line,
    Math.max(0, headerStart),
    position.line,
    Math.min(line.length, headerEnd),
  );

  const inlinePart =
    name === "RESPONSE" || name === "ERROR"
      ? "\n\n**Inline options:** " +
        (name === "RESPONSE"
          ? "`partial` `with_asserts` `tolerance=N` `unordered_arrays` `redact=[...]`"
          : "`with_asserts`")
      : "";

  return new vscode.Hover(
    md(
      `## ${info.icon} ${name}`,
      info.doc + inlinePart,
      `| | |`,
      `|---|---|`,
      `| **Format** | ${info.bodyFormat} |`,
      `| **Multiline** | ${info.multiline ? "Yes" : "No"} |`,
      `| **Repeatable** | ${info.repeatable ? "Yes" : "No"} |`,
    ),
    range,
  );
}

function tryPluginHover(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Hover | undefined {
  const range = document.getWordRangeAtPosition(
    position,
    /@[A-Za-z_][A-Za-z0-9_]*/,
  );
  if (!range) return undefined;
  const word = document.getText(range);
  const info = PLUGINS[word];
  if (!info) return undefined;

  const exampleBlock = `\
\`\`\`grpctestify
${info.example}
\`\`\``;

  const resultLine = info.exampleResult
    ? `**Result:** \`${info.exampleResult}\``
    : "";

  const sectionsLine =
    info.sections.length > 0 ? `**Sections:** ${info.sections.join(", ")}` : "";

  const returnsLine = `**Returns:** \`${info.returns}\``;

  return new vscode.Hover(
    md(
      `## ${word}`,
      info.doc,
      `**Signature:** \`${info.signature}\``,
      exampleBlock,
      [resultLine, sectionsLine, returnsLine].filter(Boolean).join("  \n"),
    ),
    range,
  );
}

function tryKeyHover(
  line: string,
  position: vscode.Position,
): vscode.Hover | undefined {
  const keyMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  if (!keyMatch?.[1]) return undefined;
  const key = keyMatch[1];
  const info = KEY_DOCS[key];
  if (!info) return undefined;

  const keyStart = line.indexOf(key);
  const range = new vscode.Range(
    position.line,
    Math.max(0, keyStart),
    position.line,
    keyStart + key.length,
  );

  const aliasLine = info.aliases?.length
    ? `**Aliases:** ${info.aliases.map((a) => `\`${a}\``).join(", ")}`
    : "";

  return new vscode.Hover(
    md(
      `### \`${key}\``,
      info.doc,
      [`**Section:** ${info.section}`, `**Type:** \`${info.type}\``, aliasLine]
        .filter(Boolean)
        .join("  \n"),
      "```gctf",
      info.example,
      "```",
    ),
    range,
  );
}

function tryInlineOptionHover(trimmed: string): vscode.Hover | undefined {
  const optionMatch = trimmed.match(
    /\b(partial|with_asserts|tolerance|unordered_arrays|redact)\b/,
  );
  if (!optionMatch?.[1]) return undefined;
  const key = optionMatch[1];
  if (!trimmed.startsWith("---")) return undefined;
  const info = INLINE_OPTION_DOCS[key];
  if (!info) return undefined;

  return new vscode.Hover(
    md(
      `### \`${key}\` (inline option)`,
      info.doc,
      `**Applies to:** ${info.appliesTo.join(", ")}`,
      "```gctf",
      info.example,
      "```",
    ),
  );
}

function tryTemplateHover(
  line: string,
  position: vscode.Position,
): vscode.Hover | undefined {
  const templateRange = findTemplateRange(line, position.character);
  if (!templateRange) return undefined;
  const varName = line
    .slice(templateRange[0], templateRange[1])
    .replace(/^\{\{\s*|\s*\}\}$/g, "")
    .trim();

  const range = new vscode.Range(
    position.line,
    templateRange[0],
    position.line,
    templateRange[1],
  );

  return new vscode.Hover(
    md(
      `### \`{{ ${varName} }}\``,
      "Template variable resolved at execution time from an EXTRACT section.",
      "Variable values are substituted as their **native JSON type** when the entire string is a single `{{var}}`, or as **string interpolation** when embedded in a larger string.",
      "| Context | Behaviour |",
      "|---|---|",
      '| `"id": {{ user_id }}` | Type-preserving: number stays number |',
      '| `"path": "/users/{{ id }}"` | String interpolation |',
    ),
    range,
  );
}

function tryOperatorHover(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Hover | undefined {
  const wordRange = document.getWordRangeAtPosition(
    position,
    /[A-Za-z_][A-Za-z0-9_]+/,
  );
  if (!wordRange) return undefined;
  const word = document.getText(wordRange);
  const info = OPERATORS[word];
  if (!info) return undefined;

  return new vscode.Hover(
    md(
      `### \`${word}\``,
      info.doc,
      `**Kind:** ${info.kind}`,
      "```gctf",
      info.example,
      "```",
    ),
    wordRange,
  );
}

function tryStatusCodeHover(trimmed: string): vscode.Hover | undefined {
  const codeMatch = trimmed.match(/"code"\s*:\s*(\d+)/);
  if (!codeMatch?.[1]) return undefined;
  const code = parseInt(codeMatch[1], 10);
  const entry = GRPC_STATUS[code];
  if (!entry) return undefined;

  return new vscode.Hover(
    md(
      `### gRPC ${code} — ${entry[0]}`,
      entry[1],
      "```gctf",
      `"code": ${code}`,
      "```",
    ),
  );
}

function findTemplateRange(
  line: string,
  char: number,
): [number, number] | undefined {
  const idx = line.lastIndexOf("{{", char);
  if (idx < 0 || idx > char) return undefined;
  const close = line.indexOf("}}", idx);
  if (close < 0 || char > close + 2) return undefined;
  return [idx, close + 2];
}
