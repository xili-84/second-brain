import type { SecondBrainClient } from '../../lib/supabase/client';
import type { CaptureDraft } from './captureDraft';

export const IMAGE_BUCKET = 'capture-images';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PENDING_IMAGE_KEY = 'second-brain.pending-image-upload';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** How many images one capture may hold. A story plus a feed post is the common case. */
export const MAX_IMAGES_PER_CAPTURE = 10;
/** Uploads that run at once; enough to overlap latency without saturating a phone connection. */
export const UPLOAD_CONCURRENCY = 3;

/**
 * The local cleanup marker for one save attempt. `attachmentId`/`storagePath` describe the first
 * (cover) image; `additionalPaths` lists any further objects uploaded in the same attempt.
 */
export type ImageOperation = {
  additionalPaths?: string[];
  attachmentId: string;
  captureId: string;
  createdAt: string;
  /** When the save attempt started and the cleanup marker was written. */
  markedAt?: string;
  storagePath: string;
  userId: string;
};

export type ImageUploadItem = {
  attachmentId: string;
  file: File;
  /** Stable key of the draft image this upload belongs to (for progress and retry). */
  key: string;
  storagePath: string;
};

/** One multi-image save: a capture ID plus its images in display order. */
export type ImageCaptureOperation = {
  captureId: string;
  createdAt: string;
  items: ImageUploadItem[];
  userId: string;
};

export type UploadState = 'done' | 'failed' | 'uploading';

export type ImageSaveResult = {
  error: string | null;
  /** Draft keys whose upload failed; the rest are already stored and are not uploaded again. */
  failedKeys: string[];
  saved: boolean;
  /** Draft keys whose objects are stored for this operation (kept for a retry). */
  uploadedKeys: string[];
  /** Set when the capture was saved but something non-fatal went wrong. */
  warning: string | null;
};

export function imageExtension(mimeType: SupportedImageMime) {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }

  if (mimeType === 'image/png') {
    return 'png';
  }

  return 'webp';
}

export function isSupportedImageMime(value: string): value is SupportedImageMime {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

export function imageStoragePath(
  userId: string,
  captureId: string,
  attachmentId: string,
  mimeType: SupportedImageMime,
) {
  return `${userId}/${captureId}/${attachmentId}.${imageExtension(mimeType)}`;
}

export function createImageOperation(userId: string, mimeType: SupportedImageMime): ImageOperation {
  const captureId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();

  return {
    attachmentId,
    captureId,
    createdAt: new Date().toISOString(),
    storagePath: imageStoragePath(userId, captureId, attachmentId, mimeType),
    userId,
  };
}

/** Prepares upload slots (owner-scoped paths and IDs) for images that are about to be saved. */
export function createUploadItems(
  userId: string,
  captureId: string,
  images: { file: File; key: string }[],
): ImageUploadItem[] {
  return images.map(({ file, key }) => {
    const attachmentId = crypto.randomUUID();
    const mimeType = isSupportedImageMime(file.type) ? file.type : 'image/jpeg';
    return {
      attachmentId,
      file,
      key,
      storagePath: imageStoragePath(userId, captureId, attachmentId, mimeType),
    };
  });
}

export function createImageCaptureOperation(
  userId: string,
  images: { file: File; key: string }[],
): ImageCaptureOperation {
  const captureId = crypto.randomUUID();
  return {
    captureId,
    createdAt: new Date().toISOString(),
    items: createUploadItems(userId, captureId, images),
    userId,
  };
}

/** The cleanup marker covering every object of a multi-image operation. */
export function markerFor(
  userId: string,
  captureId: string,
  items: ImageUploadItem[],
  createdAt = new Date().toISOString(),
): ImageOperation | null {
  const [first, ...rest] = items;
  if (!first) {
    return null;
  }
  return {
    ...(rest.length ? { additionalPaths: rest.map((item) => item.storagePath) } : {}),
    attachmentId: first.attachmentId,
    captureId,
    createdAt,
    storagePath: first.storagePath,
    userId,
  };
}

/** Every Storage object a marker covers. */
export function operationPaths(operation: ImageOperation) {
  return [operation.storagePath, ...(operation.additionalPaths ?? [])];
}

export function validateImageMetadata(file: File) {
  if (!isSupportedImageMime(file.type)) {
    return 'Choose a JPEG, PNG, or WebP image.';
  }

  if (file.size <= 0) {
    return 'The selected image is empty.';
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return 'The selected image is larger than 10 MiB.';
  }

  return null;
}

async function readBlobBytes(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('The file could not be read.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(blob);
  });
}

async function readBlobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('The image preview could not be read.'));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('The image preview could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function hasExpectedFileSignature(file: File) {
  const bytes = new Uint8Array(await readBlobBytes(file.slice(0, 12)));

  if (file.type === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (file.type === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  return (
    file.type === 'image/webp' &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

async function decodeImage(file: File) {
  const dataUrl = await readBlobDataUrl(file);

  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => reject(new Error('Image decoding timed out.')), 10_000);

    image.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Image decoding failed.'));
    };
    image.src = dataUrl;
  });
}

export async function validateImageFile(
  file: File,
  decoder: (selectedFile: File) => Promise<void> = decodeImage,
) {
  const metadataError = validateImageMetadata(file);

  if (metadataError) {
    return metadataError;
  }

  try {
    if (!(await hasExpectedFileSignature(file))) {
      return 'The file contents do not match the selected image format.';
    }

    await decoder(file);
    return null;
  } catch {
    return 'The selected file could not be decoded as an image.';
  }
}

function isImageOperation(value: unknown): value is ImageOperation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ImageOperation>;
  return (
    typeof candidate.attachmentId === 'string' &&
    typeof candidate.captureId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.storagePath === 'string' &&
    typeof candidate.userId === 'string' &&
    (candidate.markedAt === undefined || typeof candidate.markedAt === 'string') &&
    (candidate.additionalPaths === undefined ||
      (Array.isArray(candidate.additionalPaths) &&
        candidate.additionalPaths.every((path) => typeof path === 'string')))
  );
}

export function readPendingImageOperation() {
  try {
    const storedValue = localStorage.getItem(PENDING_IMAGE_KEY);

    if (!storedValue) {
      return null;
    }

    const parsed: unknown = JSON.parse(storedValue);
    return isImageOperation(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberPendingImageOperation(operation: ImageOperation, now = new Date()) {
  try {
    localStorage.setItem(
      PENDING_IMAGE_KEY,
      JSON.stringify({ ...operation, markedAt: now.toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPendingImageOperation(operation: ImageOperation) {
  const current = readPendingImageOperation();

  if (current?.storagePath === operation.storagePath) {
    localStorage.removeItem(PENDING_IMAGE_KEY);
  }
}

export async function findCompletedAttachment(
  client: SecondBrainClient,
  operation: ImageOperation,
) {
  const { data, error } = await client
    .from('attachments')
    .select('id, capture_id, storage_path')
    .eq('id', operation.attachmentId)
    .eq('user_id', operation.userId)
    .maybeSingle();

  return {
    completed:
      data?.capture_id === operation.captureId && data.storage_path === operation.storagePath,
    error,
  };
}

/** Removes every object a marker covers, then clears the marker. */
export async function removePendingObject(client: SecondBrainClient, operation: ImageOperation) {
  const { error } = await client.storage.from(IMAGE_BUCKET).remove(operationPaths(operation));

  if (!error) {
    clearPendingImageOperation(operation);
  }

  return error;
}

export async function discardPendingImage(client: SecondBrainClient, operation: ImageOperation) {
  return removePendingObject(client, operation);
}

/** A repeated upload of an object that already exists (for example after a lost response). */
function isAlreadyStored(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { message?: unknown; status?: unknown; statusCode?: unknown };
  return (
    candidate.status === 409 ||
    candidate.statusCode === '409' ||
    candidate.statusCode === 409 ||
    (typeof candidate.message === 'string' && /already exists|duplicate/iu.test(candidate.message))
  );
}

/**
 * Uploads images to their private paths, a few at a time. Keys in `skip` are already stored and
 * are not uploaded again. Never throws; each item ends as done or failed.
 */
export async function uploadImages(
  client: SecondBrainClient,
  items: ImageUploadItem[],
  {
    concurrency = UPLOAD_CONCURRENCY,
    onItem,
    skip = new Set<string>(),
  }: {
    concurrency?: number;
    onItem?: (key: string, state: UploadState) => void;
    skip?: ReadonlySet<string>;
  } = {},
) {
  const pending = items.filter((item) => !skip.has(item.key));
  const uploaded = items.filter((item) => skip.has(item.key)).map((item) => item.key);
  const failed: string[] = [];
  const bucket = client.storage.from(IMAGE_BUCKET);
  let next = 0;

  async function worker() {
    while (next < pending.length) {
      const item = pending[next++]!;
      onItem?.(item.key, 'uploading');
      try {
        const { error } = await bucket.upload(item.storagePath, item.file, {
          cacheControl: '3600',
          contentType: item.file.type,
          upsert: false,
        });
        const ok = !error || isAlreadyStored(error);
        (ok ? uploaded : failed).push(item.key);
        onItem?.(item.key, ok ? 'done' : 'failed');
      } catch {
        failed.push(item.key);
        onItem?.(item.key, 'failed');
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, worker),
  );

  const order = new Map(items.map((item, index) => [item.key, index]));
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  return { failed: failed.sort(byOrder), uploaded: uploaded.sort(byOrder) };
}

/** Attachment rows for images after the first, timed so they sort after it in display order. */
export function attachmentRows(
  userId: string,
  captureId: string,
  items: ImageUploadItem[],
  baseTime: number,
  firstOffset = 1,
) {
  return items.map((item, index) => ({
    capture_id: captureId,
    created_at: new Date(baseTime + firstOffset + index).toISOString(),
    id: item.attachmentId,
    mime_type: item.file.type,
    original_name: item.file.name.trim().slice(-255) || `image-${index + 1}`,
    size_bytes: item.file.size,
    storage_path: item.storagePath,
    user_id: userId,
  }));
}

/**
 * Inserts attachment rows, then confirms which ones exist (an insert whose response was lost may
 * still have succeeded). Returns the IDs that are confirmed, or null when that cannot be checked.
 */
export async function insertAttachmentRows(
  client: SecondBrainClient,
  userId: string,
  rows: ReturnType<typeof attachmentRows>,
) {
  if (rows.length === 0) {
    return new Set<string>();
  }

  const { error } = await client.from('attachments').insert(rows);

  if (!error) {
    return new Set(rows.map((row) => row.id));
  }

  const { data, error: checkError } = await client
    .from('attachments')
    .select('id')
    .eq('user_id', userId)
    .in(
      'id',
      rows.map((row) => row.id),
    );

  return checkError || !data ? null : new Set(data.map((row) => row.id));
}

async function finalizeImage(
  client: SecondBrainClient,
  operation: ImageCaptureOperation,
  draft: CaptureDraft,
  first: ImageUploadItem,
) {
  const content = draft.content.trim();
  const title = draft.title.trim();
  const args = {
    p_attachment_id: first.attachmentId,
    p_capture_id: operation.captureId,
    p_mime_type: first.file.type,
    p_original_name: first.file.name,
    p_size_bytes: first.file.size,
    p_storage_path: first.storagePath,
    ...(content ? { p_content: content } : {}),
    ...(title ? { p_title: title } : {}),
  };

  return client.rpc('finalize_image_capture', args);
}

async function readCoverTime(client: SecondBrainClient, operation: ImageCaptureOperation) {
  const first = operation.items[0]!;
  const { data } = await client
    .from('attachments')
    .select('created_at')
    .eq('id', first.attachmentId)
    .eq('user_id', operation.userId)
    .maybeSingle();
  const time = data?.created_at ? Date.parse(data.created_at) : Number.NaN;
  return Number.isFinite(time) ? time : Date.now();
}

function failure(error: string, failedKeys: string[] = [], uploadedKeys: string[] = []) {
  return { error, failedKeys, saved: false, uploadedKeys, warning: null };
}

/**
 * Saves an image capture with one or more images.
 *
 * 1. A local cleanup marker covering every path is written first.
 * 2. Images upload in parallel. If any fail, nothing is created: the stored ones are kept so a
 *    retry only uploads the failures (or the user can remove them and save the rest).
 * 3. The first image and the capture are created atomically by `finalize_image_capture`.
 * 4. Further images are attached as owner-scoped rows (RLS), timed to sort after the cover.
 *    If that fails the capture is still saved with its cover; the unattached objects are removed
 *    and a warning is returned.
 */
export async function saveImageCapture(
  client: SecondBrainClient,
  operation: ImageCaptureOperation,
  draft: CaptureDraft,
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
  const [first, ...rest] = operation.items;
  const marker = markerFor(
    operation.userId,
    operation.captureId,
    operation.items,
    operation.createdAt,
  );

  if (!first || !marker) {
    return failure('Choose at least one image before saving.');
  }

  if (operation.items.length > MAX_IMAGES_PER_CAPTURE) {
    return failure(`A capture can hold up to ${MAX_IMAGES_PER_CAPTURE} images.`);
  }

  if (!rememberPendingImageOperation(marker)) {
    return failure('Image saving could not start because cleanup state is unavailable.');
  }

  const uploads = await uploadImages(client, operation.items, {
    ...(concurrency ? { concurrency } : {}),
    ...(onItem ? { onItem } : {}),
    skip: uploadedKeys,
  });

  if (uploads.failed.length > 0) {
    const total = operation.items.length;
    return failure(
      total === 1
        ? 'Image upload failed. Your draft remains available for retry.'
        : `${uploads.failed.length} of ${total} images did not upload. Retry, or remove them and save the rest.`,
      uploads.failed,
      uploads.uploaded,
    );
  }

  const { error: finalizeError } = await finalizeImage(client, operation, draft, first);

  if (finalizeError) {
    const completionCheck = await findCompletedAttachment(client, marker);

    if (completionCheck.error) {
      return failure(
        'The image upload result could not be confirmed. Nothing is reported as saved; cleanup will retry later.',
        [],
        uploads.uploaded,
      );
    }

    if (!completionCheck.completed) {
      const cleanupError = await removePendingObject(client, marker);
      return failure(
        cleanupError
          ? 'Image metadata was not saved and the uploaded object still needs cleanup. Your draft remains available.'
          : 'Image metadata was not saved. The uploaded object was removed and your draft remains available.',
      );
    }
  }

  let warning: string | null = null;

  if (rest.length > 0) {
    const baseTime = await readCoverTime(client, operation);
    const rows = attachmentRows(operation.userId, operation.captureId, rest, baseTime);
    const confirmed = await insertAttachmentRows(client, operation.userId, rows);

    if (!confirmed) {
      // Unknown state: keep the marker so reconciliation removes only what is unreferenced.
      return {
        error: null,
        failedKeys: [],
        saved: true,
        uploadedKeys: [],
        warning:
          'The capture was saved, but some images could not be confirmed. Open it to check them.',
      };
    }

    const missing = rest.filter((item) => !confirmed.has(item.attachmentId));

    if (missing.length > 0) {
      const { error: cleanupError } = await client.storage
        .from(IMAGE_BUCKET)
        .remove(missing.map((item) => item.storagePath));
      warning = `The capture was saved with ${operation.items.length - missing.length} of ${operation.items.length} images. Add the missing ones from Edit.${cleanupError ? ' Their uploads will be cleaned up later.' : ''}`;

      if (cleanupError) {
        return { error: null, failedKeys: [], saved: true, uploadedKeys: [], warning };
      }
    }
  }

  clearPendingImageOperation(marker);
  return { error: null, failedKeys: [], saved: true, uploadedKeys: [], warning };
}
