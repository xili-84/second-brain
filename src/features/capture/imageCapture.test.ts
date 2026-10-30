import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import type { CaptureDraft } from './captureDraft';
import {
  createImageCaptureOperation,
  createImageOperation,
  readPendingImageOperation,
  saveImageCapture,
  validateImageFile,
  validateImageMetadata,
  type ImageCaptureOperation,
  type ImageUploadItem,
} from './imageCapture';

const userId = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const captureId = '88aa03fb-b4de-409a-b01b-5c79dbca2fb9';
const draft: CaptureDraft = {
  content: 'Receipt from today',
  id: 'unused-for-image',
  kind: 'image',
  sourceUrl: '',
  title: 'Receipt',
};
const story = new File(['story'], 'story.png', { type: 'image/png' });
const post = new File(['post'], 'post.jpg', { type: 'image/jpeg' });

function item(key: string, file: File, attachmentId: string): ImageUploadItem {
  const extension = file.type === 'image/png' ? 'png' : 'jpg';
  return {
    attachmentId,
    file,
    key,
    storagePath: `${userId}/${captureId}/${attachmentId}.${extension}`,
  };
}

const storyItem = item('story', story, '30f6733b-97dc-4b26-b0bb-1b217254953f');
const postItem = item('post', post, '5a1c2f0e-6c1e-4b9b-9a43-0f3c7d1f8e21');

function operationOf(items: ImageUploadItem[]): ImageCaptureOperation {
  return { captureId, createdAt: '2026-10-30T16:00:00.000Z', items, userId };
}

afterEach(() => {
  localStorage.clear();
});

type Result = { data: unknown; error: unknown };

function createImageClient({
  attachmentResult = { data: { created_at: '2026-10-30T16:00:01.000Z' }, error: null },
  confirmResult = { data: [], error: null },
  finalizeResult = { data: [{ created_capture_id: captureId }], error: null },
  insertResult = { data: null, error: null },
  removeResult = { data: [], error: null },
  upload = vi.fn().mockResolvedValue({ data: {}, error: null }),
}: {
  attachmentResult?: Result;
  confirmResult?: Result;
  finalizeResult?: Result;
  insertResult?: Result;
  removeResult?: Result;
  upload?: ReturnType<typeof vi.fn>;
} = {}) {
  const remove = vi.fn().mockResolvedValue(removeResult);
  const rpc = vi.fn().mockResolvedValue(finalizeResult);
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn(() => {
    let mode: 'confirm' | 'single' = 'single';
    const builder = {
      eq: vi.fn(() => builder),
      in: vi.fn(() => {
        mode = 'confirm';
        return builder;
      }),
      insert,
      maybeSingle: vi.fn(() => Promise.resolve(attachmentResult)),
      select: vi.fn(() => builder),
      then: (resolve: (value: Result) => void) =>
        resolve(mode === 'confirm' ? confirmResult : attachmentResult),
    };
    return builder;
  });
  const client = {
    from,
    rpc,
    storage: {
      from: vi.fn().mockReturnValue({ remove, upload }),
    },
  } as unknown as SecondBrainClient;

  return { client, insert, remove, rpc, upload };
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

  it('creates one upload slot per image inside the capture folder', () => {
    const created = createImageCaptureOperation(userId, [
      { file: story, key: 'a' },
      { file: post, key: 'b' },
    ]);

    expect(created.items.map((entry) => entry.key)).toEqual(['a', 'b']);
    for (const entry of created.items) {
      expect(entry.storagePath).toMatch(
        new RegExp(`^${userId}/${created.captureId}/${entry.attachmentId}\\.(png|jpg)$`),
      );
    }
  });

  it('reports success only after upload and transactional finalization succeed', async () => {
    const { client, insert, remove, rpc, upload } = createImageClient();

    await expect(saveImageCapture(client, operationOf([storyItem]), draft)).resolves.toMatchObject({
      error: null,
      saved: true,
      warning: null,
    });
    expect(upload).toHaveBeenCalledWith(
      storyItem.storagePath,
      story,
      expect.objectContaining({ upsert: false }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'finalize_image_capture',
      expect.objectContaining({
        p_attachment_id: storyItem.attachmentId,
        p_capture_id: captureId,
      }),
    );
    expect(insert).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(readPendingImageOperation()).toBeNull();
  });

  it('uploads every image, creates the capture with the first and attaches the rest after it', async () => {
    const { client, insert, rpc, upload } = createImageClient();
    const onItem = vi.fn();

    const result = await saveImageCapture(client, operationOf([storyItem, postItem]), draft, {
      onItem,
    });

    expect(result).toMatchObject({ saved: true, warning: null });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_attachment_id: storyItem.attachmentId });
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        capture_id: captureId,
        created_at: '2026-10-30T16:00:01.001Z',
        id: postItem.attachmentId,
        mime_type: 'image/jpeg',
        original_name: 'post.jpg',
        storage_path: postItem.storagePath,
        user_id: userId,
      }),
    ]);
    expect(onItem).toHaveBeenCalledWith('story', 'done');
    expect(onItem).toHaveBeenCalledWith('post', 'done');
    expect(readPendingImageOperation()).toBeNull();
  });

  it('creates nothing when one upload fails, and a retry uploads only the failed image', async () => {
    const upload = vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          path === postItem.storagePath
            ? { data: null, error: new Error('network') }
            : { data: {}, error: null },
        ),
      );
    const { client, rpc } = createImageClient({ upload });

    const first = await saveImageCapture(client, operationOf([storyItem, postItem]), draft);

    expect(first).toMatchObject({ failedKeys: ['post'], saved: false, uploadedKeys: ['story'] });
    expect(first.error).toContain('1 of 2 images did not upload');
    expect(rpc).not.toHaveBeenCalled();
    // The marker stays so the stored image is cleaned up if the draft is abandoned.
    expect(readPendingImageOperation()?.additionalPaths).toEqual([postItem.storagePath]);

    upload.mockClear();
    upload.mockResolvedValue({ data: {}, error: null });
    const retry = await saveImageCapture(client, operationOf([storyItem, postItem]), draft, {
      uploadedKeys: new Set(first.uploadedKeys),
    });

    expect(retry.saved).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(postItem.storagePath, post, expect.anything());
  });

  it('treats an upload that already exists (lost response) as stored', async () => {
    const upload = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'The resource already exists', statusCode: '409' },
    });
    const { client, rpc } = createImageClient({ upload });

    await expect(saveImageCapture(client, operationOf([storyItem]), draft)).resolves.toMatchObject({
      saved: true,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('removes every uploaded object and reports no success when finalization fails', async () => {
    const { client, remove } = createImageClient({
      attachmentResult: { data: null, error: null },
      finalizeResult: { data: null, error: new Error('database unavailable') },
    });

    const result = await saveImageCapture(client, operationOf([storyItem, postItem]), draft);

    expect(result.saved).toBe(false);
    expect(result.uploadedKeys).toEqual([]);
    expect(result.error).toContain('metadata was not saved');
    expect(remove).toHaveBeenCalledWith([storyItem.storagePath, postItem.storagePath]);
    expect(readPendingImageOperation()).toBeNull();
  });

  it('keeps the capture and removes unattached uploads when extra images cannot be attached', async () => {
    const { client, remove } = createImageClient({
      confirmResult: { data: [], error: null },
      insertResult: { data: null, error: new Error('insert failed') },
    });

    const result = await saveImageCapture(client, operationOf([storyItem, postItem]), draft);

    expect(result.saved).toBe(true);
    expect(result.warning).toContain('saved with 1 of 2 images');
    expect(remove).toHaveBeenCalledWith([postItem.storagePath]);
    expect(readPendingImageOperation()).toBeNull();
  });

  it('refuses more than the per-capture image limit before uploading', async () => {
    const { client, upload } = createImageClient();
    const many = Array.from({ length: 11 }, (_, index) =>
      item(`k${index}`, post, `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    );

    const result = await saveImageCapture(client, operationOf(many), draft);

    expect(result.saved).toBe(false);
    expect(result.error).toContain('up to 10 images');
    expect(upload).not.toHaveBeenCalled();
  });
});
