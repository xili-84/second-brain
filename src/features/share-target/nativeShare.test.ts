import { describe, expect, it, vi } from 'vitest';

import { loadPendingSharedImage, type PendingSharedImage } from './nativeShare';

function readText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

describe('native shared image handoff', () => {
  const pendingImage: PendingSharedImage = {
    mimeType: 'image/png',
    name: 'shared-photo.png',
    size: 4,
    uri: 'file:///private/pending-shares/shared-photo.png',
  };

  it('recreates the private native image as a browser File', async () => {
    const readChunk = vi.fn().mockResolvedValue({
      complete: true,
      data: btoa('png!'),
      nextOffset: 4,
    });

    const loaded = await loadPendingSharedImage('share-id', pendingImage, readChunk);

    expect(readChunk).toHaveBeenCalledWith({ id: 'share-id', offset: 0 });
    expect(loaded.file.name).toBe('shared-photo.png');
    expect(loaded.file.type).toBe('image/png');
    expect(loaded.file.size).toBe(4);
    expect(await readText(loaded.file)).toBe('png!');
  });

  it('joins multiple chunks into one file', async () => {
    const readChunk = vi
      .fn()
      .mockResolvedValueOnce({ complete: false, data: btoa('pn'), nextOffset: 2 })
      .mockResolvedValueOnce({ complete: true, data: btoa('g!'), nextOffset: 4 });

    const loaded = await loadPendingSharedImage('share-id', pendingImage, readChunk);

    expect(readChunk).toHaveBeenNthCalledWith(2, { id: 'share-id', offset: 2 });
    expect(await readText(loaded.file)).toBe('png!');
  });

  it('rejects an incomplete temporary image', async () => {
    const readChunk = vi.fn().mockResolvedValue({
      complete: true,
      data: btoa('pn'),
      nextOffset: 2,
    });

    await expect(loadPendingSharedImage('share-id', pendingImage, readChunk)).rejects.toThrow(
      'incomplete',
    );
  });
});
