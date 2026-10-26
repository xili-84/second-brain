import { describe, expect, it } from 'vitest';

import { normalizeTagName, suggestTags, tagKey, tagsFromEmbed } from './tagNames';

const library = [
  { id: '1', name: 'Design' },
  { id: '2', name: 'Admin' },
  { id: '3', name: 'okdaily' },
  { id: '4', name: 'Ideas' },
];

describe('tag names', () => {
  it('cleans typed names and enforces the database length', () => {
    expect(normalizeTagName('  ##Read   later ')).toBe('Read later');
    expect(normalizeTagName('#')).toBeNull();
    expect(normalizeTagName('   ')).toBeNull();
    expect(normalizeTagName('x'.repeat(80))).toHaveLength(50);
    expect(tagKey(' March ')).toBe('march');
  });

  it('suggests prefix matches first, then contains, without applied tags', () => {
    expect(suggestTags(library, [], 'd').map((tag) => tag.name)).toEqual([
      'Design',
      'Admin',
      'Ideas',
      'okdaily',
    ]);
    expect(suggestTags(library, [{ name: 'design' }], '#d').map((tag) => tag.name)).toEqual([
      'Admin',
      'Ideas',
      'okdaily',
    ]);
    expect(suggestTags(library, [], '').map((tag) => tag.name)).toEqual([
      'Admin',
      'Design',
      'Ideas',
      'okdaily',
    ]);
  });

  it('flattens embedded capture_tags rows and sorts them', () => {
    expect(
      tagsFromEmbed([
        { tags: { id: 'b', name: 'zeta' } },
        { tags: null },
        { tags: [{ id: 'a', name: 'Alpha' }] },
      ]),
    ).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'zeta' },
    ]);
    expect(tagsFromEmbed(undefined)).toEqual([]);
  });
});
