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

    const sectionPatternFn = (section: string) => new RegExp(`---\s*${section}\s*---([\s\S]*)?(?=---|$)`, 'g');

    // Validation ADDRESS
    const addressContent = sectionPatternFn('ADDRESS');
    let addressMatch = addressContent.exec(text);
    if (addressMatch !== null) {
        const lines = addressMatch[1]
            .split('\n')
            .map(line => line.split('#')[0].trim())
            .filter(line => line)

        const sectionStart = text.indexOf(addressMatch[0]);
        
        for (const line of lines) {
            if (!/^[\w.-]+:\d+$/.test(line)) {
                const lineStart = text.indexOf(line, sectionStart);
                
                if (lineStart === -1) continue
                
                const startPos = document.positionAt(lineStart);
                const endPos = startPos.translate(0, line.length);
                
                diagnostics.push({
                    code: 'invalidAddress',
                    message: 'Invalid address format. Expected: domain:port',
                    range: new vscode.Range(startPos, endPos),
                    severity: vscode.DiagnosticSeverity.Error
                });
            }
        }
    }

    // Validation ENDPOINT
    const endpointContent = sectionPatternFn('ENDPOINT');
    let endpointMatch = endpointContent.exec(text);
    if (endpointMatch !== null) {
        const lines = endpointMatch[1]
            .split('\n')
            .map(line => line.split('#')[0].trim()) 
            .filter(line => line)
    
        const sectionStart = text.indexOf(endpointMatch[0]);
        
        for (const line of lines) {
            if (!/^[\w.]+\/[\w.]+$/.test(line)) {
                const lineStart = text.indexOf(line, sectionStart);
                
                if (lineStart === -1) continue;
                
                const startPos = document.positionAt(lineStart);
                const endPos = startPos.translate(0, line.length);
                
                diagnostics.push({
                    code: 'invalidEndpoint',
                    message: 'Invalid endpoint format. Expected: Package.Service/Method',
                    range: new vscode.Range(startPos, endPos),
                    severity: vscode.DiagnosticSeverity.Error
                });
            }
        }
    }
  
    // Validation JSON in REQUEST and RESPONSE and ERROR
    const jsonSections = ['REQUEST', 'RESPONSE', 'ERROR'];
    jsonSections.forEach(section => {
      const sectionPattern = sectionPatternFn(section);  
      let match;
      while ((match = sectionPattern.exec(text)) !== null) {
        const jsonContent = match[1].trim();
        if (jsonContent) {
          try {
            JSON.parse(jsonContent.replace(/[,\n]?(\s*#.+)\n/g, ''));
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
      const responseContent = responseMatch[1].trim()
      const errorContent = errorMatch[1].trim()

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
