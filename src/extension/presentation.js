'use strict';
const vscode = require('vscode');

function commentMarkdown(result) {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  markdown.appendMarkdown(`**Line comment · ${result.status}**\n\n`);
  markdown.appendText(result.note.text);
  markdown.appendMarkdown('\n\n---\n');
  markdown.appendText(`${result.note.id} · ${result.reason}`);
  return markdown;
}
function diagnosticsFor(document, results) {
  return results.filter(result => ['review', 'detached', 'ambiguous'].includes(result.status)).map(result => {
    const line = Math.max(0, Math.min(document.lineCount - 1, (result.line ?? 1) - 1));
    const message = result.line === null
      ? `External comment ${result.note.id} is ${result.status} (previously line ${result.note.line}). ${result.reason}`
      : `External comment at line ${result.line} needs review. ${result.reason}`;
    const diagnostic = new vscode.Diagnostic(document.lineAt(line).range, message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = 'Line Comments'; diagnostic.code = result.note.id;
    return diagnostic;
  });
}
module.exports = { commentMarkdown, diagnosticsFor };
