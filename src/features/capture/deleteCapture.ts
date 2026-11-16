import type { SecondBrainClient } from '../../lib/supabase/client';
import { removeLinkPreviewImage } from '../linkPreview/linkPreview';
import { removeCaptureImageObjects } from './imageStorage';

/** The fields a permanent delete needs; both the detail page and the list have them. */
export type DeletableCapture = {
  attachments?: { storage_path: string }[] | null | undefined;
  id: string;
  kind: string;
  link_image_path?: string | null | undefined;
};

export type DeleteCaptureResult =
  | { ok: true }
  /**
   * `storage`: an image capture's private files could not be removed, so nothing was deleted.
   * `records`: the files are gone (or there were none) but the capture row was not deleted.
   */
  | { ok: false; reason: 'records' | 'storage' };

/**
 * Permanently deletes one capture and its private files. Image captures remove every object in
 * their folder first (the database function refuses while any remain); link captures tidy their
 * preview image on a best-effort basis. Never throws.
 */
export async function deleteCapture(
  client: SecondBrainClient,
  userId: string,
  capture: DeletableCapture,
): Promise<DeleteCaptureResult> {
  try {
    if (capture.kind === 'file') {
      // Files have no guarding database function: remove every object first, then the rows. If any
      // object cannot be removed nothing is deleted, so a file is never left without its record.
      const paths = (capture.attachments ?? []).map((attachment) => attachment.storage_path);
      const storageError = await removeCaptureImageObjects(client, userId, capture.id, paths);
      if (storageError) {
        return { ok: false, reason: 'storage' };
      }
    }

    if (capture.kind === 'image') {
      const paths = (capture.attachments ?? []).map((attachment) => attachment.storage_path);
      const storageError = await removeCaptureImageObjects(client, userId, capture.id, paths);
      if (storageError) {
        return { ok: false, reason: 'storage' };
      }

      const { data, error } = await client.rpc('delete_image_capture_after_storage', {
        p_capture_id: capture.id,
      });
      return !error && data === true ? { ok: true } : { ok: false, reason: 'records' };
    }

    if (capture.kind === 'link') {
      // Best effort first: the preview image is private, and a leftover would only waste space.
      await removeLinkPreviewImage(client, capture.link_image_path);
    }

    const { data, error } = await client
      .from('captures')
      .delete()
      .eq('id', capture.id)
      .eq('user_id', userId)
      .select('id')
      .single();
    return !error && data ? { ok: true } : { ok: false, reason: 'records' };
  } catch {
    return {
      ok: false,
      reason: capture.kind === 'image' || capture.kind === 'file' ? 'storage' : 'records',
    };
  }
}

export type BulkDeleteResult = {
  deletedIds: string[];
  failedIds: string[];
};

/**
 * Deletes several captures through the same path as a single delete, a few at a time so a long
 * selection neither floods the connection nor stops at the first failure.
 */
export async function deleteCaptures(
  client: SecondBrainClient,
  userId: string,
  captures: DeletableCapture[],
  {
    concurrency = 3,
    onProgress,
  }: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkDeleteResult> {
  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < captures.length) {
      const capture = captures[next++]!;
      const result = await deleteCapture(client, userId, capture);
      (result.ok ? deletedIds : failedIds).push(capture.id);
      done += 1;
      onProgress?.(done, captures.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, captures.length)) }, worker),
  );

  // Report in the order the captures were given, not the order they finished.
  const order = new Map(captures.map((capture, index) => [capture.id, index]));
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  return { deletedIds: deletedIds.sort(byOrder), failedIds: failedIds.sort(byOrder) };
}
