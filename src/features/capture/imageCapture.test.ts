import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import type { CaptureDraft } from './captureDraft';
import {
  createImageOperation,
  readPendingImageOperation,
  reconcileImageStorage,
  rememberPendingImageOperation,
  saveImageCapture,
  validateImageFile,
  validateImageMetadata,
  type ImageOperation,
} from './imageCapture';

const userId = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const operation: ImageOperation = {
  attachmentId: '30f6733b-97dc-4b26-b0bb-1b217254953f',
  captureId: '88aa03fb-b4de-409a-b01b-5c79dbca2fb9',
  createdAt: '2026-07-24T16:00:00.000Z',
  storagePath:
    '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d/88aa03fb-b4de-409a-b01b-5c79dbca2fb9/30f6733b-97dc-4b26-b0bb-1b217254953f.png',
  userId,
};
const draft: CaptureDraft = {
  content: 'Receipt from today',
  id: 'unused-for-image',
  kind: 'image',
  sourceUrl: '',
  title: 'Receipt',
};
const file = new File(['png'], 'receipt.png', { type: 'image/png' });

afterEach(() => {
  localStorage.clear();
});

function createImageClient({
  attachmentResult = { data: null, error: null },
  finalizeResult = { data: [{ created_capture_id: operation.captureId }], error: null },
  removeResult = { data: [], error: null },
  uploadResult = { data: { path: operation.storagePath }, error: null },
}: {
  attachmentResult?: { data: null | Record<string, string>; error: Error | null };
  finalizeResult?: { data: unknown; error: Error | null };
  removeResult?: { data: unknown[]; error: Error | null };
  uploadResult?: { data: { path: string } | null; error: Error | null };
} = {}) {
  const upload = vi.fn().mockResolvedValue(uploadResult);
  const remove = vi.fn().mockResolvedValue(removeResult);
  const rpc = vi.fn().mockResolvedValue(finalizeResult);
  const maybeSingle = vi.fn().mockResolvedValue(attachmentResult);
  const eq = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
  const select = vi.fn().mockReturnValue({ eq });
  const client = {
    from: vi.fn().mockReturnValue({ select }),
    rpc,
    storage: {
      from: vi.fn().mockReturnValue({ remove, upload }),
    },
  } as unknown as SecondBrainClient;

  return { client, remove, rpc, upload };
}

describe('image capture safety', () => {
  it('rejects unsupported and oversized files before decoding', async () => {
    const decoder = vi.fn().mockResolvedValue(undefined);
    const unsupported = new File(['gif'], 'animation.gif', { type: 'image/gif' });
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png',
    });

    expect(validateImageMetadata(unsupported)).toContain('JPEG, PNG, or WebP');
    expect(await validateImageFile(oversized, decoder)).toContain('larger than 10 MiB');
    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects a file whose contents do not match its declared image format', async () => {
    const decoder = vi.fn().mockResolvedValue(undefined);
    const disguised = new File(['not a png'], 'disguised.png', { type: 'image/png' });

    expect(await validateImageFile(disguised, decoder)).toContain(
      'do not match the selected image format',
    );
    expect(decoder).not.toHaveBeenCalled();
  });

  it('decodes a supported image after its file signature matches', async () => {
    const decoder = vi.fn().mockResolvedValue(undefined);
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const valid = new File([pngSignature], 'valid.png', { type: 'image/png' });

    await expect(validateImageFile(valid, decoder)).resolves.toBeNull();
    expect(decoder).toHaveBeenCalledWith(valid);
  });

  it('uses deterministic owner and operation IDs in the Storage path', () => {
    const created = createImageOperation(userId, 'image/webp');

    expect(created.storagePath).toBe(`${userId}/${created.captureId}/${created.attachmentId}.webp`);
  });

  it('reports success only after upload and transactional finalization succeed', async () => {
    const { client, remove, rpc, upload } = createImageClient();

    await expect(saveImageCapture(client, operation, draft, file)).resolves.toEqual({
      error: null,
      saved: true,
    });
    expect(upload).toHaveBeenCalledWith(
      operation.storagePath,
      file,
      expect.objectContaining({ upsert: false }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'finalize_image_capture',
      expect.objectContaining({
        p_attachment_id: operation.attachmentId,
        p_capture_id: operation.captureId,
      }),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(readPendingImageOperation()).toBeNull();
  });

  it('removes the uploaded object and reports no success when finalization fails', async () => {
    const { client, remove } = createImageClient({
      finalizeResult: { data: null, error: new Error('database unavailable') },
    });

    const result = await saveImageCapture(client, operation, draft, file);

    expect(result.saved).toBe(false);
    expect(result.error).toContain('metadata was not saved');
    expect(remove).toHaveBeenCalledWith([operation.storagePath]);
    expect(readPendingImageOperation()).toBeNull();
  });

  it('recognizes a successful finalization after a lost upload response', async () => {
    const { client, remove } = createImageClient({
      uploadResult: { data: null, error: new Error('response lost') },
    });

    await expect(saveImageCapture(client, operation, draft, file)).resolves.toEqual({
      error: null,
      saved: true,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('clears a stale local marker when its attachment was already finalized', async () => {
    rememberPendingImageOperation(operation);
    const completionBuilder = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          capture_id: operation.captureId,
          id: operation.attachmentId,
          storage_path: operation.storagePath,
        },
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    const attachmentListBuilder = {
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      select: vi.fn().mockReturnThis(),
    };
    const remove = vi.fn();
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(completionBuilder)
        .mockReturnValueOnce(attachmentListBuilder),
      storage: {
        from: vi.fn().mockReturnValue({
          list: vi.fn().mockResolvedValue({ data: [], error: null }),
          remove,
        }),
      },
    } as unknown as SecondBrainClient;

    await expect(reconcileImageStorage(client, userId)).resolves.toBeNull();
    expect(readPendingImageOperation()).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes only old unreferenced objects during reconciliation', async () => {
    const referencedPath = `${userId}/capture-folder/referenced.png`;
    const orphanedPath = `${userId}/capture-folder/orphaned.png`;
    const attachmentListBuilder = {
      eq: vi.fn().mockResolvedValue({
        data: [{ storage_path: referencedPath }],
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: null, name: 'capture-folder' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            created_at: '2026-07-24T12:00:00.000Z',
            id: 'referenced-object',
            name: 'referenced.png',
          },
          {
            created_at: '2026-07-24T12:00:00.000Z',
            id: 'orphaned-object',
            name: 'orphaned.png',
          },
          {
            created_at: new Date().toISOString(),
            id: 'new-object',
            name: 'new.png',
          },
        ],
        error: null,
      });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = {
      from: vi.fn().mockReturnValue(attachmentListBuilder),
      storage: {
        from: vi.fn().mockReturnValue({ list, remove }),
      },
    } as unknown as SecondBrainClient;

    await expect(reconcileImageStorage(client, userId)).resolves.toBeNull();
    expect(remove).toHaveBeenCalledWith([orphanedPath]);
  });
});
