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

    const sectionPatternFn = (section: String) => new RegExp(`--- ${section} ---(?:.|\\n)*?(?=---|$)`, 'g');

    // Validation JSON in REQUEST and RESPONSE and ERROR
    const jsonSections = ['REQUEST', 'RESPONSE', 'ERROR'];
    jsonSections.forEach(section => {
      const sectionPattern = sectionPatternFn(section);  
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

    // Validation RESPONSE and ERROR must not be filled at the same time
    const responseMatch = sectionPatternFn('RESPONSE').exec(text);
    const errorMatch = sectionPatternFn('ERROR').exec(text);

    if (responseMatch !== null && errorMatch !== null) {
      const responseContent = responseMatch[0].replace(`--- RESPONSE ---`, '').trim()
      const errorContent = errorMatch[0].replace(`--- ERROR ---`, '').trim()

      if (responseContent.length > 0 && errorContent.length > 0) {
        const responseStart = text.indexOf(responseMatch[0]);
        const errorEnd = text.indexOf(errorMatch[0]) + errorMatch[0].length;

        const startPos = document.positionAt(responseStart);
        const endPos = document.positionAt(errorEnd);

        diagnostics.push({
          code: 'bothResponseAndError',
          message: 'Only one of RESPONSE or ERROR can be filled',
          range: new vscode.Range(startPos, endPos),
          severity: vscode.DiagnosticSeverity.Error
        });
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }
}
