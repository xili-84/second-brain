import type { SecondBrainClient } from '../../lib/supabase/client';
import { MAX_FILES_PER_CAPTURE, validateAttachmentFile } from '../files/fileInfo';
import type { CaptureDraft } from './captureDraft';
import {
  attachmentRows,
  clearPendingImageOperation,
  createUploadItems,
  IMAGE_BUCKET,
  insertAttachmentRows,
  markerFor,
  rememberPendingImageOperation,
  removePendingObject,
  uploadImages,
  type ImageCaptureOperation,
  type ImageSaveResult,
  type UploadState,
} from './imageCapture';

/** A new file capture: a capture ID plus an upload slot (owner-scoped path) for each file. */
export function createFileCaptureOperation(
  userId: string,
  files: { file: File; key: string }[],
): ImageCaptureOperation {
  const captureId = crypto.randomUUID();
  return {
    captureId,
    createdAt: new Date().toISOString(),
    items: createUploadItems(userId, captureId, files, 'file'),
    userId,
  };
}

function failure(error: string, failedKeys: string[] = [], uploadedKeys: string[] = []) {
  return { error, failedKeys, saved: false, uploadedKeys, warning: null };
}

/** True when the capture row exists for this user (an insert whose response was lost may have worked). */
async function captureExists(client: SecondBrainClient, userId: string, captureId: string) {
  const { data, error } = await client
    .from('captures')
    .select('id')
    .eq('id', captureId)
    .eq('user_id', userId)
    .maybeSingle();
  return error ? null : Boolean(data);
}

/**
 * Saves a file capture: one note with any number of files (1 to MAX_FILES_PER_CAPTURE, each up to
 * 50 MB).
 *
 * 1. Every file is checked, then a local cleanup marker covering every path is written.
 * 2. Files upload a few at a time. If any fail, nothing is created: the stored ones are kept so a
 *    retry uploads only the failures (or the user can remove them and save the rest).
 * 3. The capture row is created, then one attachment row per file (owner-scoped, RLS). A row that
 *    cannot be confirmed has its object removed; if none can be attached the capture is removed.
 */
export async function saveFileCapture(
  client: SecondBrainClient,
  operation: ImageCaptureOperation,
  draft: Pick<CaptureDraft, 'content' | 'title'>,
  {
    concurrency,
    onItem,
    uploadedKeys = new Set<string>(),
  }: {
    concurrency?: number;
    onItem?: (key: string, state: UploadState) => void;
    uploadedKeys?: ReadonlySet<string>;
  } = {},
): Promise<ImageSaveResult> {
  const { captureId, items, userId } = operation;
  const marker = markerFor(userId, captureId, items, operation.createdAt);

  if (!marker) {
    return failure('Choose at least one file before saving.');
  }

  if (items.length > MAX_FILES_PER_CAPTURE) {
    return failure(`A capture can hold up to ${MAX_FILES_PER_CAPTURE} files.`);
  }

  for (const item of items) {
    const problem = validateAttachmentFile(item.file);
    if (problem) {
      return failure(problem);
    }
  }

  if (!rememberPendingImageOperation(marker)) {
    return failure('Saving could not start because cleanup state is unavailable.');
  }

  const uploads = await uploadImages(client, items, {
    ...(concurrency ? { concurrency } : {}),
    ...(onItem ? { onItem } : {}),
    skip: uploadedKeys,
  });

  if (uploads.failed.length > 0) {
    const total = items.length;
    return failure(
      total === 1
        ? 'The file did not upload. Your draft remains available for retry.'
        : `${uploads.failed.length} of ${total} files did not upload. Retry, or remove them and save the rest.`,
      uploads.failed,
      uploads.uploaded,
    );
  }

  const content = draft.content.trim();
  const title = draft.title.trim();
  const { error: insertError } = await client.from('captures').insert({
    content: content || null,
    id: captureId,
    kind: 'file',
    source_url: null,
    status: 'inbox',
    title: title || null,
    user_id: userId,
  });

  if (insertError) {
    const exists = await captureExists(client, userId, captureId);

    if (exists === null) {
      return failure(
        'The result could not be confirmed. Nothing is reported as saved; cleanup will retry later.',
        [],
        uploads.uploaded,
      );
    }

    if (!exists) {
      const cleanupError = await removePendingObject(client, marker);
      return failure(
        cleanupError
          ? 'The capture was not saved and the uploaded files still need cleanup. Your draft remains available.'
          : 'The capture was not saved. The uploaded files were removed and your draft remains available.',
      );
    }
  }

  const rows = attachmentRows(userId, captureId, items, Date.now(), 0);
  const confirmed = await insertAttachmentRows(client, userId, rows);

  if (!confirmed) {
    // Unknown state: keep the marker so reconciliation removes only what stays unreferenced.
    return {
      error: null,
      failedKeys: [],
      saved: true,
      uploadedKeys: [],
      warning:
        'The capture was saved, but some files could not be confirmed. Open it to check them.',
    };
  }

  const missing = items.filter((item) => !confirmed.has(item.attachmentId));

  if (missing.length === items.length) {
    await client.from('captures').delete().eq('id', captureId).eq('user_id', userId);
    const cleanupError = await removePendingObject(client, marker);
    return failure(
      cleanupError
        ? 'The files could not be attached and still need cleanup. Your draft remains available.'
        : 'The files could not be attached. Nothing was saved and your draft remains available.',
    );
  }

  let warning: string | null = null;

  if (missing.length > 0) {
    const { error: cleanupError } = await client.storage
      .from(IMAGE_BUCKET)
      .remove(missing.map((item) => item.storagePath));
    warning = `The capture was saved with ${items.length - missing.length} of ${items.length} files. Add the missing ones from Edit.${cleanupError ? ' Their uploads will be cleaned up later.' : ''}`;

    if (cleanupError) {
      return { error: null, failedKeys: [], saved: true, uploadedKeys: [], warning };
    }
  }

  clearPendingImageOperation(marker);
  return { error: null, failedKeys: [], saved: true, uploadedKeys: [], warning };
}
