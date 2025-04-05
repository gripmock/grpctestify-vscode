import * as vscode from 'vscode';

export class GRPCTestifyDiagnostics {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor(context: vscode.ExtensionContext) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('grpctestify');
    context.subscriptions.push(this.diagnosticCollection);
  }

  public validate(document: vscode.TextDocument) {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    // Validation ADDRESS
    const addressRegex = /^--- ADDRESS ---\s*([\s\S]*?)(?=\n---|\s*$)/m;
    const addressMatch = text.match(addressRegex);
    if (addressMatch) {
      const address = addressMatch[1].trim();
      if (address && !/^[\w.-]+:\d+$/.test(address)) {
        const startPos = document.positionAt(text.indexOf(addressMatch[0]) + addressMatch[0].indexOf(address));
        const endPos = startPos.translate(0, address.length);
        diagnostics.push({
          code: 'invalidAddress',
          message: 'Invalid address format. Expected: domain:port',
          range: new vscode.Range(startPos, endPos),
          severity: vscode.DiagnosticSeverity.Error
        });
      }
    }

    // Validation ENDPOINT
    const endpointRegex = /^--- ENDPOINT ---\s*([\s\S]*?)(?=\n---|\s*$)/m;
    const endpointMatch = text.match(endpointRegex);
    if (endpointMatch) {
      const endpoint = endpointMatch[1].trim();
      if (endpoint && !/^[\w.]+\/[\w.]+$/.test(endpoint)) {
        const startPos = document.positionAt(text.indexOf(endpointMatch[0]) + endpointMatch[0].indexOf(endpoint));
        const endPos = startPos.translate(0, endpoint.length);
        diagnostics.push({
          code: 'invalidEndpoint',
          message: 'Invalid endpoint format. Expected: Package.Service/Method',
          range: new vscode.Range(startPos, endPos),
          severity: vscode.DiagnosticSeverity.Error
        });
      }
    }

    // Validation JSON in REQUEST and RESPONSE
    const jsonSections = ['REQUEST', 'RESPONSE'];
    jsonSections.forEach(section => {
      const sectionPattern = new RegExp(`--- ${section} ---(?:.|\\n)*?(?=---|$)`, 'g');
      let match;
      while ((match = sectionPattern.exec(text)) !== null) {
        const jsonContent = match[0].replace(`--- ${section} ---`, '').trim();
        if (jsonContent) {
          try {
            JSON.parse(jsonContent);
          } catch (error: any) {
            const errorMessage = error instanceof Error 
              ? error.message 
              : 'Unknown JSON error';
            const startPos = document.positionAt(text.indexOf(match[0]) + match[0].indexOf(jsonContent));
            const endPos = startPos.translate(0, jsonContent.length);
            diagnostics.push({
              code: 'invalidJson',
              message: `JSON error in ${section}: ${errorMessage}`,
              range: new vscode.Range(startPos, endPos),
              severity: vscode.DiagnosticSeverity.Error
            });
          }
        }
      }
    });

    this.diagnosticCollection.set(document.uri, diagnostics);
  }
}