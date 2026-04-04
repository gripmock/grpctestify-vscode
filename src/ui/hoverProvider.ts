import * as vscode from "vscode";

const hoverDocs: Record<string, string> = {
  "@uuid": 'Validate UUID format. Example: `@uuid(.user.id, "v4")`',
  "@email": "Validate e-mail format. Example: `@email(.user.email)`",
  "@ip": 'Validate IP format. Example: `@ip(.client_ip, "v4")`',
  "@url": 'Validate URL format. Example: `@url(.profile.website, "https")`',
  "@timestamp":
    'Validate timestamp format. Example: `@timestamp(.created_at, "rfc3339")`',
  "@has_header":
    'Checks if response header exists. Example: `@has_header("x-request-id")`',
  "@has_trailer":
    'Checks if response trailer exists. Example: `@has_trailer("grpc-status")`',
  startsWith: "Canonical string operator for prefix checks.",
  endsWith: "Canonical string operator for suffix checks.",
  contains: "Checks substring/array containment in ASSERTS expressions.",
  matches: "Regex matching operator in ASSERTS expressions.",
};

export function registerHoverProvider(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerHoverProvider("grpctestify", {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(
        position,
        /[@A-Za-z_][A-Za-z0-9_]*/,
      );
      if (!range) {
        return undefined;
      }

      const word = document.getText(range);
      const key = word.startsWith("@") ? word : word;
      const doc = hoverDocs[key];
      if (!doc) {
        return undefined;
      }

      return new vscode.Hover(new vscode.MarkdownString(doc), range);
    },
  });

  context.subscriptions.push(provider);
}
