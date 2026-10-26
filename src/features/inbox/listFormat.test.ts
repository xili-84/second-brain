import { describe, expect, it } from 'vitest';

import {
  captureTitle,
  displayUrl,
  domainOf,
  groupByDay,
  isUntitledLink,
  relativeTime,
} from './listFormat';

describe('list formatting', () => {
  it('falls back from title to URL to an untitled label', () => {
    expect(captureTitle({ kind: 'note', source_url: null, title: '  Idea  ' })).toBe('Idea');
    expect(captureTitle({ kind: 'link', source_url: 'https://a.test/x', title: ' ' })).toBe(
      'https://a.test/x',
    );
    expect(captureTitle({ kind: 'image', source_url: null, title: null })).toBe('Untitled image');
    expect(isUntitledLink({ kind: 'link', source_url: 'https://a.test', title: null })).toBe(true);
    expect(isUntitledLink({ kind: 'link', source_url: 'https://a.test', title: 'A' })).toBe(false);
  });

  it('shortens URLs and extracts domains safely', () => {
    expect(displayUrl('https://www.example.com/path?q=1')).toBe('example.com/path?q=1');
    expect(domainOf('https://www.politico.eu/article')).toBe('politico.eu');
    expect(domainOf('not a url')).toBeNull();
    expect(domainOf(null)).toBeNull();
  });

  it('describes recent times relatively', () => {
    const now = Date.parse('2026-10-26T12:00:00.000Z');
    expect(relativeTime('2026-10-26T11:59:30.000Z', now)).toBe('Just now');
    expect(relativeTime('2026-10-26T11:36:00.000Z', now)).toBe('24 min ago');
    expect(relativeTime('2026-10-26T07:00:00.000Z', now)).toBe('5 h ago');
    expect(relativeTime('invalid', now)).toBe('');
    expect(relativeTime('2026-10-20T07:00:00.000Z', now)).not.toMatch(/ago/u);
  });

  it('groups newest-first items by local day, keeping order', () => {
    const now = new Date(2026, 9, 26, 12, 0);
    const at = (day: number, hour = 9) => ({
      created_at: new Date(2026, 9, day, hour).toISOString(),
    });
    const items = [at(26, 11), at(26, 8), at(25), at(22), at(1)];

    const groups = groupByDay(items, now);

    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['This week', 1],
      ['Earlier', 1],
    ]);
    expect(groups[0]?.items[0]).toBe(items[0]);
  });
});
