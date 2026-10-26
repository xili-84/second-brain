import { describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { createImageSignedUrl, removeCaptureImageObjects } from './imageStorage';

const userId = 'user-1';
const captureId = 'capture-1';

function createStorageClient(initial: string[], { listError = false, removeError = false } = {}) {
  const objects = new Set(initial);
  const list = vi.fn((folder: string) => {
    if (listError) {
      return Promise.resolve({ data: null, error: new Error('list failed') });
    }

    const data = [...objects]
      .filter((path) => path.startsWith(`${folder}/`))
      .map((path) => ({ id: `id-${path}`, name: path.slice(folder.length + 1) }));
    return Promise.resolve({ data, error: null });
  });
  const remove = vi.fn((paths: string[]) => {
    if (removeError) {
      return Promise.resolve({ data: null, error: new Error('remove failed') });
    }

    paths.forEach((path) => objects.delete(path));
    return Promise.resolve({ data: [], error: null });
  });
  const createSignedUrl = vi.fn((path: string, ttl: number) =>
    Promise.resolve({ data: { signedUrl: `https://signed/${path}?ttl=${ttl}` }, error: null }),
  );
  const client = {
    storage: { from: vi.fn(() => ({ createSignedUrl, list, remove })) },
  } as unknown as SecondBrainClient;

  return { client, createSignedUrl, objects, remove };
}

describe('capture image storage', () => {
  it('removes stray objects left in the capture folder, not only the current attachment', async () => {
    const current = `${userId}/${captureId}/current.png`;
    const stray = `${userId}/${captureId}/previous.png`;
    const other = `${userId}/other-capture/keep.png`;
    const { client, objects, remove } = createStorageClient([current, stray, other]);

    await expect(removeCaptureImageObjects(client, userId, captureId, [current])).resolves.toBe(
      null,
    );
    expect(remove).toHaveBeenCalledWith(expect.arrayContaining([current, stray]));
    expect([...objects]).toEqual([other]);
  });

  it('leaves other captures untouched', async () => {
    const outside = `${userId}/other-capture/keep.png`;
    const { client, objects, remove } = createStorageClient([outside]);

    await expect(removeCaptureImageObjects(client, userId, captureId, [])).resolves.toBe(null);
    expect(remove).not.toHaveBeenCalled();
    expect(objects.has(outside)).toBe(true);
  });

  it('reports an error and removes nothing when the folder cannot be listed', async () => {
    const { client, remove } = createStorageClient([], { listError: true });

    await expect(
      removeCaptureImageObjects(client, userId, captureId, [`${userId}/${captureId}/a.png`]),
    ).resolves.toBeInstanceOf(Error);
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports an error when Storage removal fails', async () => {
    const path = `${userId}/${captureId}/a.png`;
    const { client } = createStorageClient([path], { removeError: true });

    await expect(
      removeCaptureImageObjects(client, userId, captureId, [path]),
    ).resolves.toBeInstanceOf(Error);
  });

  it('creates a fresh signed URL on demand', async () => {
    const { client, createSignedUrl } = createStorageClient([]);

    await expect(createImageSignedUrl(client, 'a/b.png', 300)).resolves.toBe(
      'https://signed/a/b.png?ttl=300',
    );
    expect(createSignedUrl).toHaveBeenCalledWith('a/b.png', 300);
  });
});
