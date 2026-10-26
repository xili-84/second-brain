import type { SecondBrainClient } from '../../lib/supabase/client';
import type { CaptureDraft } from './captureDraft';

export const IMAGE_BUCKET = 'capture-images';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PENDING_IMAGE_KEY = 'second-brain.pending-image-upload';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageOperation = {
  attachmentId: string;
  captureId: string;
  createdAt: string;
  /** When the save attempt started and the cleanup marker was written. */
  markedAt?: string;
  storagePath: string;
  userId: string;
};

export type ImageSaveResult = {
  error: string | null;
  saved: boolean;
};

function imageExtension(mimeType: SupportedImageMime) {
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

export function createImageOperation(userId: string, mimeType: SupportedImageMime): ImageOperation {
  const captureId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();

  return {
    attachmentId,
    captureId,
    createdAt: new Date().toISOString(),
    storagePath: `${userId}/${captureId}/${attachmentId}.${imageExtension(mimeType)}`,
    userId,
  };
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
    (candidate.markedAt === undefined || typeof candidate.markedAt === 'string')
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

async function finalizeImage(
  client: SecondBrainClient,
  operation: ImageOperation,
  draft: CaptureDraft,
  file: File,
) {
  const content = draft.content.trim();
  const title = draft.title.trim();
  const args = {
    p_attachment_id: operation.attachmentId,
    p_capture_id: operation.captureId,
    p_mime_type: file.type,
    p_original_name: file.name,
    p_size_bytes: file.size,
    p_storage_path: operation.storagePath,
    ...(content ? { p_content: content } : {}),
    ...(title ? { p_title: title } : {}),
  };

  return client.rpc('finalize_image_capture', args);
}

export async function removePendingObject(client: SecondBrainClient, operation: ImageOperation) {
  const { error } = await client.storage.from(IMAGE_BUCKET).remove([operation.storagePath]);

  if (!error) {
    clearPendingImageOperation(operation);
  }

  return error;
}

export async function discardPendingImage(client: SecondBrainClient, operation: ImageOperation) {
  return removePendingObject(client, operation);
}

export async function saveImageCapture(
  client: SecondBrainClient,
  operation: ImageOperation,
  draft: CaptureDraft,
  file: File,
): Promise<ImageSaveResult> {
  if (!rememberPendingImageOperation(operation)) {
    return {
      error: 'Image saving could not start because cleanup state is unavailable.',
      saved: false,
    };
  }

  const { error: uploadError } = await client.storage
    .from(IMAGE_BUCKET)
    .upload(operation.storagePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    const { error: finalizeError } = await finalizeImage(client, operation, draft, file);

    if (!finalizeError) {
      clearPendingImageOperation(operation);
      return { error: null, saved: true };
    }

    const cleanupError = await removePendingObject(client, operation);
    return {
      error: cleanupError
        ? 'Image upload failed and cleanup is still pending. Your draft remains available.'
        : 'Image upload failed. Your draft remains available for retry.',
      saved: false,
    };
  }

  const { error: finalizeError } = await finalizeImage(client, operation, draft, file);

  if (!finalizeError) {
    clearPendingImageOperation(operation);
    return { error: null, saved: true };
  }

  const completionCheck = await findCompletedAttachment(client, operation);

  if (completionCheck.completed) {
    clearPendingImageOperation(operation);
    return { error: null, saved: true };
  }

  if (completionCheck.error) {
    return {
      error:
        'The image upload result could not be confirmed. Nothing is reported as saved; cleanup will retry later.',
      saved: false,
    };
  }

  const cleanupError = await removePendingObject(client, operation);
  return {
    error: cleanupError
      ? 'Image metadata was not saved and the uploaded object still needs cleanup. Your draft remains available.'
      : 'Image metadata was not saved. The uploaded object was removed and your draft remains available.',
    saved: false,
  };
}
