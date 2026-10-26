import { describe, expect, it } from 'vitest';

import { makeSnippet, splitHighlights } from './highlight';

describe('splitHighlights', () => {
  it('marks every case-insensitive match and keeps the rest as plain text', () => {
    expect(splitHighlights('Invoice for the INVOICES folder', ['invoice'])).toEqual([
      { match: true, text: 'Invoice' },
      { match: false, text: ' for the ' },
      { match: true, text: 'INVOICE' },
      { match: false, text: 'S folder' },
    ]);
  });

  it('prefers the longest overlapping term and handles accents', () => {
    expect(splitHighlights('Café Cafeteria', ['caf', 'café'])).toEqual([
      { match: true, text: 'Café' },
      { match: false, text: ' ' },
      { match: true, text: 'Caf' },
      { match: false, text: 'eteria' },
    ]);
  });

  it('treats regex characters and markup in terms and text literally', () => {
    expect(splitHighlights('<b>a+b</b> (x)', ['a+b', '(x)'])).toEqual([
      { match: false, text: '<b>' },
      { match: true, text: 'a+b' },
      { match: false, text: '</b> ' },
      { match: true, text: '(x)' },
    ]);
  });

  it('returns the text unchanged without terms, and nothing for empty text', () => {
    expect(splitHighlights('Plain', [])).toEqual([{ match: false, text: 'Plain' }]);
    expect(splitHighlights('', ['x'])).toEqual([]);
  });
});

describe('makeSnippet', () => {
  const long = `${'intro words '.repeat(20)}the needle is here ${'trailing words '.repeat(20)}`;

  it('centres the excerpt on the first match with ellipses on cut sides', () => {
    const snippet = makeSnippet(long, ['needle'], 30);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('the needle is here');
    expect(snippet.length).toBeLessThan(80);
  });

  it('starts at the beginning when the match is early or absent', () => {
    expect(makeSnippet('needle first\n\nthen more', ['needle'])).toBe('needle first then more');
    expect(makeSnippet(long, ['absent'], 10)).toBe('intro words intro…');
  });

  it('returns an empty string for empty content', () => {
    expect(makeSnippet(null, ['x'])).toBe('');
    expect(makeSnippet('   ', ['x'])).toBe('');
  });
});
