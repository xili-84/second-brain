import type { SecondBrainClient } from '../../lib/supabase/client';
import {
  attachmentRows,
  clearPendingImageOperation,
  createUploadItems,
  IMAGE_BUCKET,
  insertAttachmentRows,
  markerFor,
  MAX_IMAGES_PER_CAPTURE,
  rememberPendingImageOperation,
  uploadImages,
  type UploadState,
} from './imageCapture';
import { ATTACHMENT_COLUMNS, sortAttachments, type StoredImageAttachment } from './imageStorage';

/** One image in an edited capture, in the order the user wants: already stored, or newly added. */
export type EditedImage =
  | { attachment: StoredImageAttachment; key: string; kind: 'stored' }
  | { file: File; key: string; kind: 'new' };

export type ImageEditResult = {
  /** The capture's images after the edit, in display order (null when nothing changed). */
  attachments: StoredImageAttachment[] | null;
  error: string | null;
  /** Keys of new images whose upload failed. */
  failedKeys: string[];
  saved: boolean;
  warning: string | null;
};

/** True when the edited list differs from what is stored (added, removed or reordered). */
export function hasImageChanges(current: StoredImageAttachment[], next: EditedImage[]) {
  if (current.length !== next.length) {
    return true;
  }
  return next.some(
    (image, index) => image.kind !== 'stored' || image.attachment.id !== current[index]?.id,
  );
}

function failed(error: string, failedKeys: string[] = []): ImageEditResult {
  return { attachments: null, error, failedKeys, saved: false, warning: null };
}

/**
 * Applies an image edit to a saved capture.
 *
 * Order of operations keeps a referenced image from ever being deleted and keeps the capture
 * usable if a step fails:
 * 1. New images upload (in parallel). Any failure aborts before the database changes, and the
 *    new uploads are removed again.
 * 2. Their attachment rows are inserted.
 * 3. Display order is written as row timestamps.
 * 4. Removed rows are deleted, then their private objects. A leftover object is unreferenced and
 *    is swept by reconciliation later.
 */
export async function applyImageEdits(
  client: SecondBrainClient,
  userId: string,
  captureId: string,
  current: StoredImageAttachment[],
  next: EditedImage[],
  {
    concurrency,
    onItem,
  }: { concurrency?: number; onItem?: (key: string, state: UploadState) => void } = {},
): Promise<ImageEditResult> {
  if (next.length === 0) {
    return failed('Keep at least one image, or delete the capture instead.');
  }

  if (next.length > MAX_IMAGES_PER_CAPTURE) {
    return failed(`A capture can hold up to ${MAX_IMAGES_PER_CAPTURE} images.`);
  }

  const ordered = sortAttachments(current);
  const added = next.flatMap((image) => (image.kind === 'new' ? [image] : []));
  const keptIds = new Set(
    next.flatMap((image) => (image.kind === 'stored' ? [image.attachment.id] : [])),
  );
  const removed = ordered.filter((attachment) => !keptIds.has(attachment.id));
  const uploads = createUploadItems(userId, captureId, added);
  const marker = markerFor(userId, captureId, uploads);
  const bucket = client.storage.from(IMAGE_BUCKET);

  if (marker && !rememberPendingImageOperation(marker)) {
    return failed('Image saving could not start because cleanup state is unavailable.');
  }

  if (uploads.length > 0) {
    const result = await uploadImages(client, uploads, {
      ...(concurrency ? { concurrency } : {}),
      ...(onItem ? { onItem } : {}),
    });

    if (result.failed.length > 0) {
      const stored = uploads.filter((item) => result.uploaded.includes(item.key));
      if (stored.length > 0) {
        await bucket.remove(stored.map((item) => item.storagePath));
      }
      if (marker) {
        clearPendingImageOperation(marker);
      }
      return failed(
        `${result.failed.length} of ${uploads.length} new ${uploads.length === 1 ? 'image' : 'images'} did not upload. Nothing was changed; retry or remove ${result.failed.length === 1 ? 'it' : 'them'}.`,
        result.failed,
      );
    }
  }

  // Display order is stored as row timestamps 1 ms apart, starting at the earliest existing one.
  const earliest = ordered
    .map((attachment) => (attachment.created_at ? Date.parse(attachment.created_at) : Number.NaN))
    .filter(Number.isFinite);
  const baseTime = earliest.length ? Math.min(...earliest) : Date.now();
  const slot = new Map(next.map((image, index) => [image.key, index]));
  const uploadByKey = new Map(uploads.map((item) => [item.key, item]));
  let keepMarker = false;

  if (uploads.length > 0) {
    const rows = uploads.map(
      (item) => attachmentRows(userId, captureId, [item], baseTime, slot.get(item.key) ?? 0)[0]!,
    );
    const confirmed = await insertAttachmentRows(client, userId, rows);

    if (!confirmed) {
      // Unknown state: keep the marker so reconciliation removes only what stays unreferenced.
      keepMarker = true;
    } else {
      const missing = uploads.filter((item) => !confirmed.has(item.attachmentId));

      if (missing.length > 0) {
        await bucket.remove(missing.map((item) => item.storagePath));
      }

      if (missing.length === uploads.length) {
        if (marker) {
          clearPendingImageOperation(marker);
        }
        return failed('The new images could not be attached. Nothing was changed; please retry.');
      }
    }
  }

  const warnings: string[] = [];

  // Reorder kept images whose timestamp does not match their new slot.
  const reorders = next.flatMap((image, index) => {
    if (image.kind !== 'stored') {
      return [];
    }
    const wanted = new Date(baseTime + index).toISOString();
    const currentTime = image.attachment.created_at
      ? Date.parse(image.attachment.created_at)
      : Number.NaN;
    return currentTime === baseTime + index ? [] : [{ id: image.attachment.id, wanted }];
  });
  const reorderResults = await Promise.all(
    reorders.map(({ id, wanted }) =>
      client
        .from('attachments')
        .update({ created_at: wanted })
        .eq('id', id)
        .eq('capture_id', captureId)
        .eq('user_id', userId),
    ),
  );
  if (reorderResults.some((result) => result.error)) {
    warnings.push('The new image order could not be fully saved.');
  }

  if (removed.length > 0) {
    const { error: deleteError } = await client
      .from('attachments')
      .delete()
      .eq('capture_id', captureId)
      .eq('user_id', userId)
      .in(
        'id',
        removed.map((attachment) => attachment.id),
      );

    if (deleteError) {
      warnings.push('Some removed images are still attached. Try removing them again.');
    } else {
      const { error: cleanupError } = await bucket.remove(
        removed.map((attachment) => attachment.storage_path),
      );
      if (cleanupError) {
        warnings.push('Cleanup of removed private images will be retried later.');
      }
    }
  }

  if (marker && !keepMarker) {
    clearPendingImageOperation(marker);
  }

  // Read back what is actually stored so the page shows the truth, not the intent.
  const { data, error } = await client
    .from('attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('capture_id', captureId)
    .eq('user_id', userId);

  const attachments =
    !error && data
      ? sortAttachments(data as StoredImageAttachment[])
      : next.flatMap((image, index): StoredImageAttachment[] => {
          if (image.kind === 'stored') {
            return [{ ...image.attachment, created_at: new Date(baseTime + index).toISOString() }];
          }
          const item = uploadByKey.get(image.key);
          return item
            ? [
                {
                  created_at: new Date(baseTime + index).toISOString(),
                  id: item.attachmentId,
                  mime_type: item.file.type,
                  original_name: item.file.name,
                  size_bytes: item.file.size,
                  storage_path: item.storagePath,
                },
              ]
            : [];
        });

  if (uploads.length > 0) {
    const storedIds = new Set(attachments.map((attachment) => attachment.id));
    if (uploads.some((item) => !storedIds.has(item.attachmentId))) {
      warnings.push('Some new images could not be attached. Add them again from Edit.');
    }
  }

  return {
    attachments,
    error: null,
    failedKeys: [],
    saved: true,
    warning: warnings.length ? warnings.join(' ') : null,
  };
}
