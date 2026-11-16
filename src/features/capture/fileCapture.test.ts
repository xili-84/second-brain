import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { MAX_FILE_BYTES } from '../files/fileInfo';
import { createFileCaptureOperation, saveFileCapture } from './fileCapture';
import { readPendingImageOperation } from './imageCapture';

const USER = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const draft = { content: ' why ', title: ' Papers ' };

function file(name: string, type = 'application/pdf', size = 3) {
  const made = new File(['x'.repeat(Math.min(size, 16))], name, { type });
  if (size > 16) {
    Object.defineProperty(made, 'size', { value: size });
  }
  return made;
}

type Row = {
  created_at: string;
  id: string;
  mime_type: string;
  original_name: string;
  size_bytes: number;
};

type Options = {
  attachmentInsertError?: boolean;
  attachmentsStored?: 'all' | 'none' | 'some';
  captureExists?: boolean;
  captureInsertError?: boolean;
  uploadFailures?: string[];
};

function createClient(options: Options = {}) {
  const uploads: { options: unknown; path: string }[] = [];
  const upload = vi.fn(async (path: string, _body: File, uploadOptions: unknown) => {
    if (options.uploadFailures?.some((name) => path.includes(name))) {
      return { data: null, error: { message: 'network' } };
    }
    uploads.push({ options: uploadOptions, path });
    return { data: { path }, error: null };
  });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });

  const capturesInsert = vi.fn(async () =>
    options.captureInsertError ? { error: { message: 'boom' } } : { error: null },
  );
  const capturesDelete = vi.fn();
  const capturesBuilder = {
    delete: capturesDelete,
    eq: vi.fn(),
    insert: capturesInsert,
    maybeSingle: vi.fn(async () => ({
      data: options.captureExists ? { id: 'x' } : null,
      error: null,
    })),
    select: vi.fn(),
  };
  capturesBuilder.select.mockReturnValue(capturesBuilder);
  capturesBuilder.eq.mockReturnValue(capturesBuilder);
  capturesDelete.mockReturnValue(capturesBuilder);

  let inserted: Row[] = [];
  const attachmentsInsert = vi.fn(async (rows: Row[]) => {
    inserted = rows;
    return options.attachmentInsertError ? { error: { message: 'rls' } } : { error: null };
  });
  const attachmentsBuilder = {
    in: vi.fn(async () => ({
      data:
        options.attachmentsStored === 'none'
          ? []
          : options.attachmentsStored === 'some'
            ? inserted.slice(0, 1).map((row) => ({ id: row.id }))
            : inserted.map((row) => ({ id: row.id })),
      error: null,
    })),
    eq: vi.fn(),
    insert: attachmentsInsert,
    select: vi.fn(),
  };
  attachmentsBuilder.select.mockReturnValue(attachmentsBuilder);
  attachmentsBuilder.eq.mockReturnValue(attachmentsBuilder);

  const client = {
    from: vi.fn((table: string) => (table === 'captures' ? capturesBuilder : attachmentsBuilder)),
    storage: { from: vi.fn().mockReturnValue({ remove, upload }) },
  } as unknown as SecondBrainClient;

  return { attachmentsInsert, capturesBuilder, capturesInsert, client, remove, upload, uploads };
}

function operation(...files: File[]) {
  return createFileCaptureOperation(
    USER,
    files.map((item, index) => ({ file: item, key: `k${index}` })),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('saveFileCapture', () => {
  it('uploads every file, creates a file capture and attaches the files in order', async () => {
    const { attachmentsInsert, capturesInsert, client, uploads } = createClient();
    const fileOp = createFileCaptureOperation(USER, [
      { file: file('Report.PDF'), key: 'a' },
      { file: file('app.apk', 'application/vnd.android.package-archive'), key: 'b' },
    ]);
    const op = fileOp;
    // File slots keep the original extension rather than guessing an image type.
    expect(fileOp.items.map((item) => item.storagePath.split('.').pop())).toEqual(['pdf', 'apk']);

    const result = await saveFileCapture(client, fileOp, draft);

    expect(result).toEqual({
      error: null,
      failedKeys: [],
      saved: true,
      uploadedKeys: [],
      warning: null,
    });
    expect(uploads.map((upload) => upload.path)).toEqual(
      fileOp.items.map((item) => item.storagePath),
    );
    expect(capturesInsert).toHaveBeenCalledWith({
      content: 'why',
      id: op.captureId,
      kind: 'file',
      source_url: null,
      status: 'inbox',
      title: 'Papers',
      user_id: USER,
    });
    const rows = attachmentsInsert.mock.calls[0]![0] as Row[];
    expect(rows.map((row) => [row.original_name, row.mime_type])).toEqual([
      ['Report.PDF', 'application/pdf'],
      ['app.apk', 'application/vnd.android.package-archive'],
    ]);
    // Display order is the order picked.
    expect(Date.parse(rows[0]!.created_at)).toBeLessThan(Date.parse(rows[1]!.created_at));
    // The cleanup marker is gone once everything is attached.
    expect(readPendingImageOperation()).toBeNull();
  });

  it('refuses a file over 50 MB before anything is uploaded', async () => {
    const { client, upload } = createClient();
    const result = await saveFileCapture(
      client,
      operation(file('huge.zip', 'application/zip', MAX_FILE_BYTES + 1)),
      draft,
    );

    expect(result.saved).toBe(false);
    expect(result.error).toMatch(/huge\.zip is .* Files can be up to 50 MB\./u);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses an empty list and more than ten files', async () => {
    const { client } = createClient();
    expect((await saveFileCapture(client, operation(), draft)).error).toBe(
      'Choose at least one file before saving.',
    );
    const many = Array.from({ length: 11 }, (_, index) => file(`f${index}.txt`, 'text/plain'));
    expect((await saveFileCapture(client, operation(...many), draft)).error).toBe(
      'A capture can hold up to 10 files.',
    );
  });

  it('creates nothing when an upload fails and reports which file to retry', async () => {
    const { capturesInsert, client } = createClient({ uploadFailures: ['.txt'] });
    const op = operation(file('a.pdf'), file('b.txt', 'text/plain'));

    const result = await saveFileCapture(client, op, draft);

    expect(result).toMatchObject({
      error: '1 of 2 files did not upload. Retry, or remove them and save the rest.',
      failedKeys: ['k1'],
      saved: false,
      uploadedKeys: ['k0'],
    });
    expect(capturesInsert).not.toHaveBeenCalled();
    // The marker stays so the stored file is cleaned up if the user walks away.
    expect(readPendingImageOperation()?.captureId).toBe(op.captureId);
  });

  it('removes the uploaded files when the capture cannot be created', async () => {
    const { client, remove } = createClient({ captureInsertError: true });
    const op = operation(file('a.pdf'));

    const result = await saveFileCapture(client, op, draft);

    expect(result.saved).toBe(false);
    expect(result.error).toMatch(/uploaded files were removed/u);
    expect(remove).toHaveBeenCalledWith([op.items[0]!.storagePath]);
    expect(readPendingImageOperation()).toBeNull();
  });

  it('carries on when a lost response hid a capture that was in fact created', async () => {
    const { attachmentsInsert, client } = createClient({
      captureExists: true,
      captureInsertError: true,
    });

    const result = await saveFileCapture(client, operation(file('a.pdf')), draft);

    expect(result.saved).toBe(true);
    expect(attachmentsInsert).toHaveBeenCalled();
  });

  it('removes the capture again when no file could be attached', async () => {
    const { capturesBuilder, client, remove } = createClient({
      attachmentInsertError: true,
      attachmentsStored: 'none',
    });
    const op = operation(file('a.pdf'));

    const result = await saveFileCapture(client, op, draft);

    expect(result.saved).toBe(false);
    expect(capturesBuilder.delete).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith([op.items[0]!.storagePath]);
  });

  it('keeps a capture with some of its files and removes the objects that were not attached', async () => {
    const { client, remove } = createClient({
      attachmentInsertError: true,
      attachmentsStored: 'some',
    });
    const op = operation(file('a.pdf'), file('b.pdf'));

    const result = await saveFileCapture(client, op, draft);

    expect(result.saved).toBe(true);
    expect(result.warning).toMatch(/saved with 1 of 2 files/u);
    expect(remove).toHaveBeenCalledWith([op.items[1]!.storagePath]);
  });
});
