'use strict';
const vscode = require('vscode');

function createHighlights() {
  const types = new Map();
  for (const style of ['line', 'underline']) {
    for (const state of ['highlight', 'review']) {
      const options = {
        isWholeLine: style === 'line',
        borderStyle: 'solid',
        borderWidth: style === 'line' ? '0 0 0 2px' : '0 0 1px 0',
        borderColor: new vscode.ThemeColor(`commentSidecar.${state}Border`),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      };
      if (style === 'line') {
        options.backgroundColor = new vscode.ThemeColor(`commentSidecar.${state}Background`);
      }
      types.set(`${style}:${state}`, vscode.window.createTextEditorDecorationType(options));
    }
  }
  return {
    apply(editor, results, style) {
      const groups = new Map();
      if (style === 'line' || style === 'underline') {
        for (const item of results) {
          if (item.line === null || item.line < 1 || item.line > editor.document.lineCount) {
            continue;
          }
          const needsReview = item.status === 'review' || groups.get(item.line) === 'review';
          const state = needsReview ? 'review' : 'highlight';
          groups.set(item.line, state);
        }
      }

      const ranges = new Map([...types.keys()].map(key => [key, []]));
      for (const [line, state] of groups) {
        const sourceLine = editor.document.lineAt(line - 1);
        const first = style === 'underline' ? Math.max(0, sourceLine.text.search(/\S/)) : 0;
        // Range[] permits empty positions for whole-line decorations on blank lines.
        const range = new vscode.Range(line - 1, first, line - 1, sourceLine.text.length);
        ranges.get(`${style}:${state}`).push(range);
      }

      // Clear inactive styles too, including when comments are removed or moved.
      for (const [key, type] of types) {
        editor.setDecorations(type, ranges.get(key));
      }
    },
    dispose() {
      for (const type of types.values()) {
        type.dispose();
      }
    },
  };
}
module.exports = { createHighlights };
