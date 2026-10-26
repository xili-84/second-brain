import { describe, expect, it } from 'vitest';

import { createTableClient } from '../../test/fakeTables';
import { applyTags, attachTag, ensureTag, setFavorite } from './tagsApi';

const USER = 'user-1';

describe('tags API', () => {
  it('reuses a known tag case-insensitively without writing', async () => {
    const { calls, client } = createTableClient({ capture_tags: [], captures: [], tags: [] });

    await expect(
      ensureTag(client, USER, 'design', [{ id: 't1', name: 'Design' }]),
    ).resolves.toEqual({ id: 't1', name: 'Design' });
    expect(calls).toHaveLength(0);
  });

  it('creates a missing tag, and falls back to the stored one after a duplicate error', async () => {
    const tables = {
      capture_tags: [],
      captures: [],
      tags: [{ id: 'stored', name: 'March', user_id: USER }],
    };
    const { client } = createTableClient(tables);

    await expect(ensureTag(client, USER, 'Finance', [])).resolves.toMatchObject({
      name: 'Finance',
    });
    // Not in the (stale) library, but already in the database.
    await expect(ensureTag(client, USER, 'march', [])).resolves.toEqual({
      id: 'stored',
      name: 'March',
    });
    expect(tables.tags).toHaveLength(2);
  });

  it('treats an existing link as success and attaches every tag once', async () => {
    const tables = {
      capture_tags: [] as Record<string, unknown>[],
      captures: [{ id: 'c1' }],
      tags: [{ id: 't1', name: 'Ideas', user_id: USER }],
    };
    const { client } = createTableClient(tables, {
      'capture_tags.insert': { code: '23505', message: 'duplicate' },
    });
    await expect(attachTag(client, USER, 'c1', 't1')).resolves.toBeUndefined();

    const fresh = createTableClient({ ...tables, capture_tags: [] });
    const applied = await applyTags(fresh.client, USER, 'c1', ['Ideas', 'New'], tables.tags);
    expect(applied.map((tag) => tag.name)).toEqual(['Ideas', 'New']);
    expect(fresh.calls.filter((call) => call.table === 'capture_tags')).toHaveLength(2);
  });

  it('reports a favorite that could not be saved', async () => {
    const { client } = createTableClient(
      { capture_tags: [], captures: [{ id: 'c1', is_favorite: false }], tags: [] },
      { 'captures.update': { message: 'offline' } },
    );
    await expect(setFavorite(client, 'c1', true)).rejects.toThrow('favorite');
  });
});
