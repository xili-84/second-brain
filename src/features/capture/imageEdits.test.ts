import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { readPendingImageOperation } from './imageCapture';
import { applyImageEdits, hasImageChanges, type EditedImage } from './imageEdits';
import type { StoredImageAttachment } from './imageStorage';

const USER = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const CAPTURE = 'capture-1';

type Row = StoredImageAttachment & { capture_id: string; user_id: string };

function stored(id: string, createdAt: string): Row {
  return {
    capture_id: CAPTURE,
    created_at: createdAt,
    id,
    mime_type: 'image/png',
    original_name: `${id}.png`,
    size_bytes: 10,
    storage_path: `${USER}/${CAPTURE}/${id}.png`,
    user_id: USER,
  };
}

/** A tiny in-memory attachments table with the filters the edit uses. */
function createBackend(
  rows: Row[],
  {
    deleteError = false,
    insertError = false,
    uploadFails = [] as string[],
  }: { deleteError?: boolean; insertError?: boolean; uploadFails?: string[] } = {},
) {
  const table = [...rows];
  const upload = vi.fn((path: string, file: File) =>
    Promise.resolve(
      uploadFails.includes(file.name)
        ? { data: null, error: new Error('offline') }
        : { data: { path }, error: null },
    ),
  );
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });

  const from = vi.fn(() => {
    const filters: ((row: Row) => boolean)[] = [];
    let mode: 'delete' | 'select' | 'update' = 'select';
    let patch: Partial<Row> = {};
    const builder = {
      delete: () => {
        mode = 'delete';
        return builder;
      },
      eq: (column: keyof Row, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: keyof Row, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      insert: (newRows: Row[]) => {
        if (insertError) {
          return Promise.resolve({ data: null, error: new Error('insert failed') });
        }
        table.push(...newRows);
        return Promise.resolve({ data: null, error: null });
      },
      select: () => builder,
      then: (resolve: (value: unknown) => void) => {
        const matching = table.filter((row) => filters.every((filter) => filter(row)));
        if (mode === 'delete') {
          if (deleteError) {
            resolve({ data: null, error: new Error('delete failed') });
            return;
          }
          matching.forEach((row) => table.splice(table.indexOf(row), 1));
        }
        if (mode === 'update') {
          matching.forEach((row) => Object.assign(row, patch));
        }
        resolve({ data: matching.map((row) => ({ ...row })), error: null });
      },
      update: (values: Partial<Row>) => {
        mode = 'update';
        patch = values;
        return builder;
      },
    };
    return builder;
  });

  const client = {
    from,
    storage: { from: vi.fn().mockReturnValue({ remove, upload }) },
  } as unknown as SecondBrainClient;
  return { client, remove, table, upload };
}

const a = stored('a', '2026-10-30T10:00:00.000Z');
const b = stored('b', '2026-10-30T10:00:00.001Z');
const keep = (row: Row): EditedImage => ({
  attachment: row,
  key: `stored-${row.id}`,
  kind: 'stored',
});
const add = (name: string): EditedImage => ({
  file: new File([name], name, { type: 'image/jpeg' }),
  key: `new-${name}`,
  kind: 'new',
});

afterEach(() => localStorage.clear());

describe('applyImageEdits', () => {
  it('detects additions, removals and reordering', () => {
    expect(hasImageChanges([a, b], [keep(a), keep(b)])).toBe(false);
    expect(hasImageChanges([a, b], [keep(b), keep(a)])).toBe(true);
    expect(hasImageChanges([a, b], [keep(a)])).toBe(true);
    expect(hasImageChanges([a], [keep(a), add('post.jpg')])).toBe(true);
  });

  it('adds a new image after the existing ones and returns the stored order', async () => {
    const { client, table, upload } = createBackend([a]);

    const result = await applyImageEdits(client, USER, CAPTURE, [a], [keep(a), add('post.jpg')]);

    expect(result.saved).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toMatch(new RegExp(`^${USER}/${CAPTURE}/[0-9a-f-]+\\.jpg$`));
    expect(table).toHaveLength(2);
    expect(result.attachments?.map((row) => row.original_name)).toEqual(['a.png', 'post.jpg']);
    expect(result.attachments?.[1]?.created_at).toBe('2026-10-30T10:00:00.001Z');
    expect(readPendingImageOperation()).toBeNull();
  });

  it('removes a dropped image row before deleting its private object', async () => {
    const { client, remove, table } = createBackend([a, b]);

    const result = await applyImageEdits(client, USER, CAPTURE, [a, b], [keep(b)]);

    expect(result.saved).toBe(true);
    expect(table.map((row) => row.id)).toEqual(['b']);
    expect(remove).toHaveBeenCalledWith([a.storage_path]);
    expect(result.attachments?.map((row) => row.id)).toEqual(['b']);
  });

  it('stores a new order as row timestamps', async () => {
    const { client } = createBackend([stored('a', a.created_at!), stored('b', b.created_at!)]);

    const result = await applyImageEdits(client, USER, CAPTURE, [a, b], [keep(b), keep(a)]);

    expect(result.attachments?.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('changes nothing when a new image fails to upload', async () => {
    const { client, remove, table } = createBackend([a, b], { uploadFails: ['bad.jpg'] });

    const result = await applyImageEdits(
      client,
      USER,
      CAPTURE,
      [a, b],
      [keep(a), add('good.jpg'), add('bad.jpg')],
    );

    expect(result.saved).toBe(false);
    expect(result.failedKeys).toEqual(['new-bad.jpg']);
    expect(result.error).toContain('1 of 2 new images did not upload');
    // The successful upload is removed again and the stored images are untouched.
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![0]).toHaveLength(1);
    expect(table.map((row) => row.id)).toEqual(['a', 'b']);
    expect(readPendingImageOperation()).toBeNull();
  });

  it('keeps the old images and removes uploads when new rows cannot be attached', async () => {
    const { client, remove, table } = createBackend([a], { insertError: true });

    const result = await applyImageEdits(client, USER, CAPTURE, [a], [add('post.jpg')]);

    expect(result.saved).toBe(false);
    expect(table.map((row) => row.id)).toEqual(['a']);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalledWith([a.storage_path]);
  });

  it('keeps an image whose row could not be deleted and says so', async () => {
    const { client, remove } = createBackend([a, b], { deleteError: true });

    const result = await applyImageEdits(client, USER, CAPTURE, [a, b], [keep(a)]);

    expect(result.saved).toBe(true);
    expect(result.warning).toContain('still attached');
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses to leave an image capture without images', async () => {
    const { client, upload } = createBackend([a]);

    const result = await applyImageEdits(client, USER, CAPTURE, [a], []);

    expect(result.saved).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });
});
