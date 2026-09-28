const KEYWORDS = new Set(['export', 'function', 'const', 'if', 'return']);

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Just enough TSX highlighting for the example: keywords, JSX tags, calls, attributes, punctuation.
export function highlight(text) {
  const tokens = text.match(/\s+|[A-Za-z_]\w*|<\/?|\/?>|./g) || [];
  let html = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^\s+$/.test(token)) {
      html += token;
      continue;
    }
    let kind = 'p';
    if (KEYWORDS.has(token)) {
      kind = 'kw';
    } else if (/^[A-Za-z_]/.test(token)) {
      if (tokens[i - 1] === '<') {
        kind = 'tag';
      } else if (tokens[i + 1] === '(') {
        kind = 'fn';
      } else if (tokens[i + 1] === '=' && tokens[i + 2] === '{') {
        kind = 'attr';
      } else {
        kind = 'v';
      }
    }
    html += `<span class="${kind}">${escapeHtml(token)}</span>`;
  }
  return html;
}

// The brand ring: eight round dashes with the gap centred at the top. Without a size, CSS sizes it.
export function ring(size) {
  const radius = 50;
  const stroke = radius * 0.313;
  const r = radius - stroke / 2;
  const segment = (2 * Math.PI * r) / 8;
  const dash = segment * 0.8 - stroke;
  const gap = segment - dash;
  const dimensions = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="ring"${dimensions} viewBox="-50 -50 100 100" aria-hidden="true">`
    + `<circle r="${r.toFixed(2)}" fill="none" stroke="currentColor" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round"`
    + ` stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-gap / 2).toFixed(2)}" transform="rotate(-90)"/></svg>`;
}

// The end-of-line marker, as the extension draws it. `extra` is placed inside it and moves with it.
export function marker({ review = false, extra = '' } = {}) {
  const className = review ? 'mk review' : 'mk';
  return `<span class="${className}">${ring(13)}<span>comment</span><span class="bang">!</span>${extra}</span>`;
}

// Colored spans for a list of [kind, text] segments.
export function segments(parts, prefix) {
  return parts.map(([kind, text]) => `<span class="${prefix}${kind}">${escapeHtml(text)}</span>`).join('');
}
