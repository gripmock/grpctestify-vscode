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
        const sections = this.parseSections(text);

        this.validateSection({
            text, document,
            sectionName: 'ADDRESS',
            validator: (line) => /^[\w.-]+:\d+$/.test(line),
            errorCode: 'invalidAddress',
            errorMessage: 'Invalid address format. Expected: domain:port'
        }, diagnostics, sections);

        this.validateSection({
            text, document,
            sectionName: 'ENDPOINT',
            validator: (line) => /^[\w.]+\/[\w.]+$/.test(line),
            errorCode: 'invalidEndpoint',
            errorMessage: 'Invalid endpoint format. Expected: Package.Service/Method'
        }, diagnostics, sections);

        ['REQUEST', 'RESPONSE', 'ERROR'].forEach(section => {
            this.validateJsonSection({ text, document, sectionName: section }, diagnostics, sections);
        });

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private parseSections(text: string): Map<string, { headerStart: number, contentStart: number, contentEnd: number }> {
      const sections = new Map();
      const regex = /^---\s+(\w+)\s+---/gm;
      let matches;

      interface SectionPosition {
          sectionName: string;
          headerStart: number;
          headerEnd: number;
      }
      const sectionPositions: SectionPosition[] = [];
  
      while ((matches = regex.exec(text)) !== null) {
          const sectionName = matches[1];
          const headerStart = matches.index;
          const headerEnd = regex.lastIndex;
        
          if (headerEnd > text.length) {
            break;
          }
    
          sectionPositions.push({ sectionName, headerStart, headerEnd });
      }
  
      sectionPositions.forEach((pos, index) => {
          const nextPos = sectionPositions[index + 1];
          const contentStart = pos.headerEnd;
          const contentEnd = nextPos ? nextPos.headerStart : text.length;
          sections.set(pos.sectionName, { 
              headerStart: pos.headerStart,
              contentStart,
              contentEnd 
          });
      });
  
      return sections;
    }

    private validateSection(
      { text, document, sectionName, validator, errorCode, errorMessage }: 
      { text: string, document: vscode.TextDocument, sectionName: string, validator: (line: string) => boolean, errorCode: string, errorMessage: string },
      diagnostics: vscode.Diagnostic[],
      sections: Map<string, { headerStart: number, contentStart: number, contentEnd: number }>
  ) {
      const section = sections.get(sectionName);
      if (!section) return;
  
      if (section.contentStart < 0 || section.contentEnd > text.length) {
          return;
      }
  
      const content = text.slice(section.contentStart, section.contentEnd);
      const lines = content.split(/\r?\n/);
  
      lines.forEach((originalLine, index) => {
          const lineOffset = section.contentStart + lines.slice(0, index).join('\n').length;
          const processedLine = originalLine.split('#')[0].trim();
          
          if (!processedLine) return;
  
          const codeStart = originalLine.indexOf(processedLine);
          const absoluteStart = lineOffset + codeStart;
          const absoluteEnd = absoluteStart + processedLine.length;
  
          if (absoluteStart < 0 || absoluteStart >= text.length) return;
          if (absoluteEnd < 0 || absoluteEnd > text.length) return;
  
          if (!validator(processedLine)) {
              const startPos = document.positionAt(absoluteStart);
              const endPos = document.positionAt(absoluteEnd);
              
              diagnostics.push({
                  code: errorCode,
                  message: errorMessage,
                  range: new vscode.Range(startPos, endPos),
                  severity: vscode.DiagnosticSeverity.Error
              });
          }
      });
  }
  
  private validateJsonSection(
      { text, document, sectionName }: 
      { text: string, document: vscode.TextDocument, sectionName: string },
      diagnostics: vscode.Diagnostic[],
      sections: Map<string, { headerStart: number, contentStart: number, contentEnd: number }>
  ) {
      const section = sections.get(sectionName);
      if (!section) return;
  
      if (section.contentStart < 0 || section.contentEnd > text.length) {
          return;
      }
  
      const content = text.slice(section.contentStart, section.contentEnd);
  
      if (!this.isSectionFilled(content)) return;
  
      try {
          this.parseJsonWithComments(content);
      } catch (error: any) {
          const errorPosition = this.getJsonErrorPosition(content, error);
          const startPosInContent = errorPosition.start;
          const endPosInContent = errorPosition.end;
  
          if (startPosInContent < 0 || endPosInContent > content.length) {
              return;
          }
  
          const absoluteStart = section.contentStart + startPosInContent;
          const absoluteEnd = section.contentStart + endPosInContent;

          if (absoluteStart < 0 || absoluteEnd > text.length) {
              return;
          }
  
          const startPos = document.positionAt(absoluteStart);
          const endPos = document.positionAt(absoluteEnd);
          
          diagnostics.push({
              code: 'invalidJson',
              message: `JSON error in ${sectionName}: ${error.message}`,
              range: new vscode.Range(startPos, endPos),
              severity: vscode.DiagnosticSeverity.Error
          });
      }
  }

    private parseJsonWithComments(content: string): any {
        const cleaned = content
            .split('\n')
            .map(line => line.split('#')[0].trim())
            .filter(line => line)
            .join('\n');

        return JSON.parse(cleaned);
    }

    private getJsonErrorPosition(content: string, error: any): { start: number, end: number } {
        try {
            const match = error.message.match(/at position (\d+)/);
            if (match) {
                const pos = parseInt(match[1]);
                return { start: pos, end: pos + 1 };
            }
        } catch {}

        return { start: 0, end: content.length };
    }

    private isSectionFilled(content: string): boolean {
        return content.split('\n')
            .map(line => line.split('#')[0].trim())
            .some(line => line.length > 0);
    }
}
