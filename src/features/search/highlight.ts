export type HighlightPart = { match: boolean; text: string };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildMatcher(terms: string[]) {
  const usable = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  return usable.length === 0 ? null : new RegExp(usable.map(escapeRegExp).join('|'), 'giu');
}

/** Splits text into plain and matching parts. Rendered as text nodes, never as HTML. */
export function splitHighlights(text: string, terms: string[]): HighlightPart[] {
  const matcher = buildMatcher(terms);
  if (!matcher || !text) {
    return text ? [{ match: false, text }] : [];
  }

  const parts: HighlightPart[] = [];
  let cursor = 0;

  for (const found of text.matchAll(matcher)) {
    const start = found.index;
    if (start > cursor) {
      parts.push({ match: false, text: text.slice(cursor, start) });
    }
    parts.push({ match: true, text: found[0] });
    cursor = start + found[0].length;
  }

  if (cursor < text.length) {
    parts.push({ match: false, text: text.slice(cursor) });
  }

  return parts;
}

/**
 * Returns a short, single-line excerpt centred on the first match, or the start of the text
 * when nothing in it matches (the match may be in the title or link instead).
 */
export function makeSnippet(text: string | null, terms: string[], radius = 70): string {
  const flat = (text ?? '').replace(/\s+/gu, ' ').trim();
  if (!flat) {
    return '';
  }

  const matcher = buildMatcher(terms);
  const first = matcher ? flat.search(matcher) : -1;

  if (first <= radius) {
    return clip(flat, 0, Math.max(radius * 2, first + radius));
  }

  const boundary = flat.indexOf(' ', first - radius);
  const start = boundary !== -1 && boundary < first ? boundary + 1 : first - radius;
  return `…${clip(flat, start, first + radius)}`;
}

/** Cuts text to [start, end), backing the end up to a word boundary and adding an ellipsis. */
function clip(text: string, start: number, end: number) {
  if (end >= text.length) {
    return text.slice(start).trim();
  }
  const lastSpace = text.lastIndexOf(' ', end);
  const cut = lastSpace > start ? lastSpace : end;
  return `${text.slice(start, cut).trim()}…`;
}
