import type { SecondBrainClient } from '../../lib/supabase/client';
import { IMAGE_BUCKET } from './imageCapture';

export const SIGNED_URL_TTL_SECONDS = 60 * 60;
/** Short-lived link used for a single native download. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 20;

export async function createImageSignedUrl(
  client: SecondBrainClient,
  storagePath: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
) {
  const { data, error } = await client.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);

  return error || !data?.signedUrl ? null : data.signedUrl;
}

/**
 * Lists every object in a capture's private folder. Returns null when the folder cannot be listed
 * completely, so callers never act on a partial view.
 */
export async function listCaptureFolder(
  client: SecondBrainClient,
  userId: string,
  captureId: string,
) {
  const folder = `${userId}/${captureId}`;
  const paths: string[] = [];

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const { data, error } = await client.storage.from(IMAGE_BUCKET).list(folder, {
      limit: LIST_PAGE_SIZE,
      offset: page * LIST_PAGE_SIZE,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error || !data) {
      return null;
    }

    for (const entry of data) {
      if (entry.id) {
        paths.push(`${folder}/${entry.name}`);
      }
    }

    if (data.length < LIST_PAGE_SIZE) {
      return paths;
    }
  }

  return null;
}

/**
 * Removes the capture's attachment objects and any stray objects left in its folder (for example
 * an older image whose cleanup failed after a replacement). The database deletion function refuses
 * to run while any object remains in the folder, so this must succeed first.
 */
export async function removeCaptureImageObjects(
  client: SecondBrainClient,
  userId: string,
  captureId: string,
  knownPaths: string[],
) {
  const folderPaths = await listCaptureFolder(client, userId, captureId);

  if (!folderPaths) {
    return new Error('The private image folder could not be listed.');
  }

  // Known paths come from this capture's own attachment rows; folder paths are its stray objects.
  const paths = [...new Set([...knownPaths, ...folderPaths])];

  if (paths.length === 0) {
    return null;
  }

  const { error } = await client.storage.from(IMAGE_BUCKET).remove(paths);

  if (error) {
    return error;
  }

  const remaining = await listCaptureFolder(client, userId, captureId);

  if (!remaining) {
    return new Error('The private image folder could not be re-checked.');
  }

  return remaining.length === 0 ? null : new Error('Some private images could not be removed.');
}

export type StoredImageAttachment = {
  created_at?: string | null;
  id: string;
  mime_type: string;
  original_name: string;
  size_bytes: number;
  storage_path: string;
};

/** Columns every attachment read selects, so ordering and per-image saving always work. */
export const ATTACHMENT_COLUMNS =
  'id, storage_path, original_name, mime_type, size_bytes, created_at';

/**
 * Display order of a capture's images: oldest first (the first image is the cover), with the ID as
 * a stable tie-breaker. Rows without a timestamp keep their relative order at the end.
 */
export function sortAttachments<T extends { created_at?: string | null; id?: string }>(
  attachments: readonly T[] | null | undefined,
): T[] {
  const time = (value: string | null | undefined) => {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  };
  return (attachments ?? [])
    .map((attachment, index) => ({ attachment, index }))
    .sort(
      (a, b) =>
        time(a.attachment.created_at) - time(b.attachment.created_at) ||
        (a.attachment.id ?? '').localeCompare(b.attachment.id ?? '') ||
        a.index - b.index,
    )
    .map(({ attachment }) => attachment);
}

/** A short signed link that makes the browser download the file under its original name. */
export async function createImageDownloadUrl(
  client: SecondBrainClient,
  storagePath: string,
  fileName: string,
) {
  const { data, error } = await client.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(storagePath, DOWNLOAD_URL_TTL_SECONDS, { download: fileName });

  return error || !data?.signedUrl ? null : data.signedUrl;
}
