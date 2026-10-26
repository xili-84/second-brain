import type { SecondBrainClient } from '../../lib/supabase/client';
import { IMAGE_BUCKET, isSupportedImageMime, type SupportedImageMime } from './imageCapture';

export type StoredImageAttachment = {
  id: string;
  mime_type: string;
  original_name: string;
  size_bytes: number;
  storage_path: string;
};

export type ImageReplacementResult = {
  attachment: StoredImageAttachment | null;
  error: string | null;
  replaced: boolean;
  warning: string | null;
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

function replacementPath(userId: string, captureId: string, mimeType: SupportedImageMime) {
  return `${userId}/${captureId}/${crypto.randomUUID()}.${imageExtension(mimeType)}`;
}

async function readAttachment(
  client: SecondBrainClient,
  attachmentId: string,
  captureId: string,
  userId: string,
) {
  return client
    .from('attachments')
    .select('id, storage_path, original_name, mime_type, size_bytes')
    .eq('id', attachmentId)
    .eq('capture_id', captureId)
    .eq('user_id', userId)
    .maybeSingle();
}

export async function replaceImageAttachment(
  client: SecondBrainClient,
  userId: string,
  captureId: string,
  current: StoredImageAttachment,
  file: File,
): Promise<ImageReplacementResult> {
  if (!isSupportedImageMime(file.type)) {
    return {
      attachment: null,
      error: 'The replacement must be a JPEG, PNG, or WebP image.',
      replaced: false,
      warning: null,
    };
  }

  const storagePath = replacementPath(userId, captureId, file.type);
  const bucket = client.storage.from(IMAGE_BUCKET);
  const { error: uploadError } = await bucket.upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    return {
      attachment: null,
      error: 'The replacement image could not be uploaded. The original image is unchanged.',
      replaced: false,
      warning: null,
    };
  }

  const replacement = {
    id: current.id,
    mime_type: file.type,
    original_name: file.name,
    size_bytes: file.size,
    storage_path: storagePath,
  };
  const { data, error: updateError } = await client
    .from('attachments')
    .update({
      mime_type: replacement.mime_type,
      original_name: replacement.original_name,
      size_bytes: replacement.size_bytes,
      storage_path: replacement.storage_path,
    })
    .eq('id', current.id)
    .eq('capture_id', captureId)
    .eq('user_id', userId)
    .select('id, storage_path, original_name, mime_type, size_bytes')
    .single();

  let confirmed = data;

  if (updateError || !confirmed) {
    const completion = await readAttachment(client, current.id, captureId, userId);
    confirmed =
      !completion.error && completion.data?.storage_path === storagePath ? completion.data : null;
  }

  if (!confirmed) {
    await bucket.remove([storagePath]);
    return {
      attachment: null,
      error: 'The replacement metadata could not be saved. The original image is still attached.',
      replaced: false,
      warning: null,
    };
  }

  const { error: cleanupError } = await bucket.remove([current.storage_path]);

  return {
    attachment: confirmed,
    error: null,
    replaced: true,
    warning: cleanupError
      ? 'The replacement was saved. Cleanup of the previous private image will be retried later.'
      : null,
  };
}
