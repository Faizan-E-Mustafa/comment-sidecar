'use strict';
const vscode = require('vscode');
const { NEEDS_ATTENTION } = require('../core/anchors');
const { isSidecar } = require('../core/sidecar');

function markerText(needsReview, style) {
  const label = style === 'icon' ? '◌' : '◌ comment';
  if (needsReview) {
    return `${label} !`;
  }
  return label;
}
function markerDecorations(document, byLine, { showMarkers, markerStyle }) {
  if (!showMarkers || markerStyle === 'off') {
    return [];
  }

  const options = [];
  for (const [line, notes] of byLine) {
    if (line < 1 || line > document.lineCount) {
      continue;
    }
    const needsReview = notes.some(item => item.status === 'review');
    options.push({
      range: document.lineAt(line - 1).range,
      renderOptions: { after: { contentText: markerText(needsReview, markerStyle) } },
    });
  }
  return options;
}

function sidecarDecoration(uri) {
  if (uri.scheme !== 'file' || !isSidecar(uri.fsPath)) {
    return undefined;
  }

  const decoration = new vscode.FileDecoration(
    undefined,
    'Comment Sidecar file',
    new vscode.ThemeColor('commentSidecar.sidecarForeground'),
  );
  decoration.propagate = false;
  return decoration;
}

function hoverHeader(line, count) {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  const label = count === 1 ? `Comment on line ${line}` : `${count} comments on line ${line}`;
  markdown.appendMarkdown(`**${label}**`);
  return markdown;
}

function commentMarkdown(result, options = {}) {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  markdown.appendText(result.note.text);
  if (result.status === 'review') {
    markdown.appendMarkdown('\n\n**Needs review**');
  }
  if (options.showMetadata) {
    markdown.appendMarkdown('\n\n---\n');
    markdown.appendText(`${result.note.id} · ${result.status} · ${result.reason}`);
  }
  return markdown;
}
function diagnosticsFor(document, results) {
  return results.filter(result => NEEDS_ATTENTION.includes(result.status)).map(result => {
    const line = Math.max(0, Math.min(document.lineCount - 1, (result.line ?? 1) - 1));
    const message = result.line === null
      ? `External comment ${result.note.id} is ${result.status} (previously line ${result.note.line}). ${result.reason}`
      : `External comment at line ${result.line} needs review. ${result.reason}`;
    const diagnostic = new vscode.Diagnostic(
      document.lineAt(line).range,
      message,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'Comment Sidecar';
    diagnostic.code = result.note.id;
    return diagnostic;
  });
}
module.exports = { sidecarDecoration, hoverHeader, commentMarkdown, diagnosticsFor, markerDecorations };
