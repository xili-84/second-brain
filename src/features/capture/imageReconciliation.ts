import type { SecondBrainClient } from '../../lib/supabase/client';
import {
  clearPendingImageOperation,
  findCompletedAttachment,
  IMAGE_BUCKET,
  readPendingImageOperation,
  removePendingObject,
} from './imageCapture';

/**
 * Orphan-image reconciliation.
 *
 * Safety rules (an image that is referenced by an attachment row must never be deleted):
 * - Nothing younger than IMAGE_RECONCILIATION_AGE_MS is touched, including the local pending marker.
 * - Attachment metadata is paged with an exact count; if the collected set does not match the
 *   count, or any listing hits its page cap, the sweep is skipped instead of guessing.
 * - Every deletion candidate is re-checked against the database immediately before removal.
 * - The sweep runs at most once per RECONCILIATION_INTERVAL_MS per user on a device.
 */
export const IMAGE_RECONCILIATION_AGE_MS = 60 * 60 * 1000;
export const RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RECONCILIATION_PAGE_SIZE = 1000;
export const RECONCILIATION_MAX_PAGES = 20;
export const RECONCILIATION_MAX_FOLDERS = 5000;
const VERIFY_BATCH_SIZE = 50;
const REMOVE_BATCH_SIZE = 100;
const LAST_RUN_KEY_PREFIX = 'second-brain.image-reconciliation.last-run.';

export type ReconciliationStatus = 'completed' | 'failed' | 'skipped-recent' | 'skipped-unsafe';

export type ReconciliationResult = {
  removedPaths: string[];
  status: ReconciliationStatus;
  warning: string | null;
};

export type ReconciliationOptions = {
  /** Ignore the once-per-day throttle. */
  force?: boolean;
  now?: () => number;
};

function result(
  status: ReconciliationStatus,
  warning: string | null = null,
  removedPaths: string[] = [],
): ReconciliationResult {
  return { removedPaths, status, warning };
}

function lastRunKey(userId: string) {
  return `${LAST_RUN_KEY_PREFIX}${userId}`;
}

/** Returns true when the run was claimed, false when it ran recently or cannot be recorded. */
function claimDailyRun(userId: string, now: number) {
  try {
    const previous = Number(localStorage.getItem(lastRunKey(userId)));

    if (Number.isFinite(previous) && previous > 0 && now - previous < RECONCILIATION_INTERVAL_MS) {
      return false;
    }

    localStorage.setItem(lastRunKey(userId), String(now));
    return true;
  } catch {
    // Without persistent state the throttle cannot be honoured, so do not run at all.
    return false;
  }
}

function isOldEnough(timestamp: string | null | undefined, now: number) {
  if (!timestamp) {
    return false;
  }

  const time = Date.parse(timestamp);
  return Number.isFinite(time) && now - time >= IMAGE_RECONCILIATION_AGE_MS;
}

async function findReferencedPaths(client: SecondBrainClient, userId: string, paths: string[]) {
  const referenced = new Set<string>();

  for (let index = 0; index < paths.length; index += VERIFY_BATCH_SIZE) {
    const batch = paths.slice(index, index + VERIFY_BATCH_SIZE);
    const { data, error } = await client
      .from('attachments')
      .select('storage_path')
      .eq('user_id', userId)
      .in('storage_path', batch);

    if (error || !data) {
      return null;
    }

    for (const row of data) {
      referenced.add(row.storage_path);
    }
  }

  return referenced;
}

async function reconcilePendingMarker(client: SecondBrainClient, userId: string, now: number) {
  const pending = readPendingImageOperation();

  if (!pending || pending.userId !== userId) {
    return null;
  }

  // A young marker may belong to a save that is still running in another tab or process.
  if (!isOldEnough(pending.markedAt ?? pending.createdAt, now)) {
    return null;
  }

  const completionCheck = await findCompletedAttachment(client, pending);

  if (completionCheck.error) {
    return 'An unfinished image operation could not be checked. It will be retried later.';
  }

  if (completionCheck.completed) {
    clearPendingImageOperation(pending);
    return null;
  }

  const referenced = await findReferencedPaths(client, userId, [pending.storagePath]);

  if (!referenced) {
    return 'An unfinished image operation could not be checked. It will be retried later.';
  }

  if (referenced.has(pending.storagePath)) {
    clearPendingImageOperation(pending);
    return null;
  }

  const cleanupError = await removePendingObject(client, pending);
  return cleanupError
    ? 'An unfinished image upload could not be cleaned up. It will be retried later.'
    : null;
}

async function listAllAttachmentPaths(client: SecondBrainClient, userId: string) {
  const paths = new Set<string>();
  let expected: number | null = null;
  let received = 0;

  for (let page = 0; page < RECONCILIATION_MAX_PAGES; page += 1) {
    // Offsets follow what was actually received, so a lower server max_rows cannot skip rows.
    const from = received;
    const { count, data, error } = await client
      .from('attachments')
      .select('id, storage_path', { count: 'exact' })
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + RECONCILIATION_PAGE_SIZE - 1);

    if (error || !data || typeof count !== 'number') {
      return null;
    }

    if (expected === null) {
      expected = count;
    } else if (count !== expected) {
      // Metadata changed while paging; the snapshot cannot be trusted.
      return null;
    }

    received += data.length;
    for (const row of data) {
      paths.add(row.storage_path);
    }

    if (received >= expected || data.length === 0) {
      return received === expected && paths.size === expected ? paths : null;
    }
  }

  return null;
}

type StorageEntry = { created_at?: string | null; id?: string | null; name: string };

async function listAllEntries(client: SecondBrainClient, prefix: string) {
  const entries: StorageEntry[] = [];

  for (let page = 0; page < RECONCILIATION_MAX_PAGES; page += 1) {
    const { data, error } = await client.storage.from(IMAGE_BUCKET).list(prefix, {
      limit: RECONCILIATION_PAGE_SIZE,
      offset: entries.length,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error || !data) {
      return null;
    }

    entries.push(...data);

    if (data.length < RECONCILIATION_PAGE_SIZE) {
      return entries;
    }
  }

  return null;
}

async function sweepOrphanedObjects(
  client: SecondBrainClient,
  userId: string,
  now: number,
): Promise<ReconciliationResult> {
  const referencedPaths = await listAllAttachmentPaths(client, userId);

  if (!referencedPaths) {
    return result(
      'skipped-unsafe',
      'Image cleanup skipped because attachment metadata could not be fully listed.',
    );
  }

  const folders = await listAllEntries(client, userId);

  if (!folders) {
    return result('skipped-unsafe', 'Image cleanup skipped because Storage could not be listed.');
  }

  const folderNames = folders.filter((entry) => !entry.id).map((entry) => entry.name);

  if (folderNames.length > RECONCILIATION_MAX_FOLDERS) {
    return result('skipped-unsafe', 'Image cleanup skipped because there are too many folders.');
  }

  const candidates: string[] = [];

  for (const folderName of folderNames) {
    const folderPath = `${userId}/${folderName}`;
    const objects = await listAllEntries(client, folderPath);

    if (!objects) {
      return result(
        'skipped-unsafe',
        'Image cleanup skipped because a private folder could not be listed.',
      );
    }

    for (const object of objects) {
      if (!object.id) {
        continue;
      }

      const storagePath = `${folderPath}/${object.name}`;

      if (isOldEnough(object.created_at, now) && !referencedPaths.has(storagePath)) {
        candidates.push(storagePath);
      }
    }
  }

  if (candidates.length === 0) {
    return result('completed');
  }

  // Re-check every candidate right before deleting it.
  const stillReferenced = await findReferencedPaths(client, userId, candidates);

  if (!stillReferenced) {
    return result(
      'skipped-unsafe',
      'Image cleanup skipped because candidates could not be verified.',
    );
  }

  const orphanedPaths = candidates.filter((path) => !stillReferenced.has(path));
  const removedPaths: string[] = [];

  for (let index = 0; index < orphanedPaths.length; index += REMOVE_BATCH_SIZE) {
    const batch = orphanedPaths.slice(index, index + REMOVE_BATCH_SIZE);
    const { error } = await client.storage.from(IMAGE_BUCKET).remove(batch);

    if (error) {
      return result(
        'failed',
        'Old unreferenced images could not be cleaned up. It will be retried later.',
        removedPaths,
      );
    }

    removedPaths.push(...batch);
  }

  return result('completed', null, removedPaths);
}

export async function reconcileImageStorage(
  client: SecondBrainClient,
  userId: string,
  options: ReconciliationOptions = {},
): Promise<ReconciliationResult> {
  const now = (options.now ?? Date.now)();

  if (!options.force && !claimDailyRun(userId, now)) {
    return result('skipped-recent');
  }

  const markerWarning = await reconcilePendingMarker(client, userId, now);

  if (markerWarning) {
    return result('failed', markerWarning);
  }

  return sweepOrphanedObjects(client, userId, now);
}
