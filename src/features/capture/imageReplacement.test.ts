import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { replaceImageAttachment, type StoredImageAttachment } from './imageReplacement';

const userId = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const captureId = '88aa03fb-b4de-409a-b01b-5c79dbca2fb9';
const current: StoredImageAttachment = {
  id: '30f6733b-97dc-4b26-b0bb-1b217254953f',
  mime_type: 'image/png',
  original_name: 'old.png',
  size_bytes: 1024,
  storage_path: `${userId}/${captureId}/old.png`,
};
const file = new File(['replacement'], 'replacement.webp', { type: 'image/webp' });
const replacementId = '11111111-1111-4111-8111-111111111111';
const replacementPath = `${userId}/${captureId}/${replacementId}.webp`;

function createClient({
  completionResult,
  removeResults = [{ data: [], error: null }],
  updateResult,
  uploadResult = { data: { path: 'uploaded' }, error: null },
}: {
  completionResult?: { data: Record<string, unknown> | null; error: Error | null };
  removeResults?: { data: unknown[]; error: Error | null }[];
  updateResult: { data: Record<string, unknown> | null; error: Error | null };
  uploadResult?: { data: { path: string } | null; error: Error | null };
}) {
  const upload = vi.fn().mockResolvedValue(uploadResult);
  const remove = vi.fn();
  removeResults.forEach((result) => remove.mockResolvedValueOnce(result));
  const single = vi.fn().mockResolvedValue(updateResult);
  const maybeSingle = vi.fn().mockResolvedValue(completionResult ?? { data: null, error: null });
  const updateBuilder = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single,
  };
  const readBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
    select: vi.fn().mockReturnThis(),
  };
  const update = vi.fn().mockReturnValue(updateBuilder);
  const from = vi.fn().mockReturnValueOnce({ update }).mockReturnValueOnce(readBuilder);
  const client = {
    from,
    storage: {
      from: vi.fn().mockReturnValue({ remove, upload }),
    },
  } as unknown as SecondBrainClient;

  return { client, remove, update, upload };
}

describe('image replacement safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes the new metadata before removing the old private object', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(replacementId);
    const updated = {
      ...current,
      mime_type: file.type,
      original_name: file.name,
      size_bytes: file.size,
      storage_path: replacementPath,
    };
    const { client, remove, update, upload } = createClient({
      updateResult: { data: updated, error: null },
    });

    await expect(replaceImageAttachment(client, userId, captureId, current, file)).resolves.toEqual(
      {
        attachment: updated,
        error: null,
        replaced: true,
        warning: null,
      },
    );
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${userId}/${captureId}/.+\\.webp$`)),
      file,
      expect.objectContaining({ upsert: false }),
    );
    expect(update).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith([current.storage_path]);
    expect(upload.mock.invocationCallOrder[0]!).toBeLessThan(update.mock.invocationCallOrder[0]!);
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(remove.mock.invocationCallOrder[0]!);
  });

  it('removes the unreferenced upload when metadata replacement fails', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(replacementId);
    const { client, remove } = createClient({
      updateResult: { data: null, error: new Error('database unavailable') },
    });

    const result = await replaceImageAttachment(client, userId, captureId, current, file);

    expect(result.replaced).toBe(false);
    expect(result.error).toContain('original image is still attached');
    expect(remove).toHaveBeenCalledWith([expect.stringContaining(`${userId}/${captureId}/`)]);
    expect(remove).not.toHaveBeenCalledWith([current.storage_path]);
  });

  it('accepts a committed metadata update after its response is lost', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(replacementId);
    const committed = {
      ...current,
      mime_type: file.type,
      original_name: file.name,
      size_bytes: file.size,
      storage_path: replacementPath,
    };
    const { client, remove } = createClient({
      completionResult: { data: committed, error: null },
      updateResult: { data: null, error: new Error('response lost') },
    });

    const result = await replaceImageAttachment(client, userId, captureId, current, file);

    expect(result).toEqual({
      attachment: committed,
      error: null,
      replaced: true,
      warning: null,
    });
    expect(remove).toHaveBeenCalledWith([current.storage_path]);
  });
});
