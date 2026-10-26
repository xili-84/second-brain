import { describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { deleteCapture, deleteCaptures } from './deleteCapture';

const USER = 'user-1';

function createClient({
  deleteResult = { data: { id: 'x' }, error: null },
  listResults = [{ data: [], error: null }],
  rpcResult = { data: true, error: null },
}: {
  deleteResult?: { data: unknown; error: unknown };
  listResults?: { data: unknown; error: unknown }[];
  rpcResult?: { data: unknown; error: unknown };
} = {}) {
  const single = vi.fn().mockResolvedValue(deleteResult);
  const builder = { delete: vi.fn(), eq: vi.fn(), select: vi.fn(), single };
  builder.delete.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  const list = vi.fn();
  for (const result of listResults) list.mockResolvedValueOnce(result);
  list.mockResolvedValue({ data: [], error: null });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const storageFrom = vi.fn().mockReturnValue({ list, remove });
  const client = {
    from: vi.fn().mockReturnValue(builder),
    rpc: vi.fn().mockResolvedValue(rpcResult),
    storage: { from: storageFrom },
  } as unknown as SecondBrainClient;
  return { builder, client, remove, storageFrom };
}

describe('deleteCapture', () => {
  it('deletes a note row scoped to the user', async () => {
    const { builder, client, storageFrom } = createClient();
    await expect(deleteCapture(client, USER, { id: 'n1', kind: 'note' })).resolves.toEqual({
      ok: true,
    });
    expect(builder.eq).toHaveBeenCalledWith('id', 'n1');
    expect(builder.eq).toHaveBeenCalledWith('user_id', USER);
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('removes a link preview image first, even though that is best effort', async () => {
    const { client, remove } = createClient();
    remove.mockRejectedValueOnce(new Error('offline'));
    await expect(
      deleteCapture(client, USER, { id: 'l1', kind: 'link', link_image_path: 'u/l1/preview' }),
    ).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(['u/l1/preview']);
  });

  it('refuses to delete an image capture whose files could not be removed', async () => {
    const { client } = createClient({ listResults: [{ data: null, error: { message: 'x' } }] });
    await expect(
      deleteCapture(client, USER, { attachments: [], id: 'i1', kind: 'image' }),
    ).resolves.toEqual({ ok: false, reason: 'storage' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('reports a row that was not deleted', async () => {
    const { client } = createClient({ deleteResult: { data: null, error: { message: 'x' } } });
    await expect(deleteCapture(client, USER, { id: 'n1', kind: 'note' })).resolves.toEqual({
      ok: false,
      reason: 'records',
    });
  });
});

describe('deleteCaptures', () => {
  it('keeps going after a failure and reports ids in the given order', async () => {
    const { builder, client } = createClient();
    builder.single
      .mockResolvedValueOnce({ data: { id: 'a' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: { id: 'c' }, error: null });
    const onProgress = vi.fn();

    const result = await deleteCaptures(
      client,
      USER,
      ['a', 'b', 'c'].map((id) => ({ id, kind: 'note' })),
      { concurrency: 1, onProgress },
    );

    expect(result).toEqual({ deletedIds: ['a', 'c'], failedIds: ['b'] });
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });
});
