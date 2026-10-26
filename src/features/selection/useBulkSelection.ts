import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { deleteCaptures, type DeletableCapture } from '../capture/deleteCapture';

export type BulkNotice = { text: string; tone: 'error' | 'success' };

function captures(count: number) {
  return count === 1 ? '1 capture' : `${count} captures`;
}

/** The message after a bulk delete; exported for tests. */
export function bulkDeleteNotice(deleted: number, failed: number): BulkNotice {
  if (failed === 0) {
    return { text: `Deleted ${captures(deleted)}.`, tone: 'success' };
  }
  const total = deleted + failed;
  const lead =
    deleted === 0
      ? `${failed === 1 ? 'The capture' : `All ${failed} captures`} could not be deleted.`
      : `Deleted ${deleted} of ${total}. ${captures(failed)} could not be deleted.`;
  return {
    text: `${lead} ${failed === 1 ? 'It is' : 'They are'} still selected; check your connection and try again.`,
    tone: 'error',
  };
}

type Options<T extends DeletableCapture> = {
  client: SecondBrainClient;
  /** Called with the ids that were deleted, so the list can drop them. */
  onDeleted: (ids: string[]) => void;
  userId: string | undefined;
  /** The rows on screen; only these can be selected (filters hide the rest). */
  visible: readonly T[];
};

/** Select mode for a capture list: ticking rows, select all, and one confirmed bulk delete. */
export function useBulkSelection<T extends DeletableCapture>({
  client,
  onDeleted,
  userId,
  visible,
}: Options<T>) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<BulkNotice | null>(null);

  // Only rows still on screen count: a filter change or a refresh can hide selected ones.
  const selected = useMemo(
    () => visible.filter((capture) => selectedIds.has(capture.id)),
    [selectedIds, visible],
  );
  const effectiveIds = useMemo(() => new Set(selected.map((capture) => capture.id)), [selected]);

  const start = useCallback(() => {
    setNotice(null);
    setSelectedIds(new Set());
    setIsSelecting(true);
  }, []);

  const stop = useCallback(() => {
    setIsSelecting(false);
    setIsConfirming(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(
      selected.length === visible.length
        ? new Set()
        : new Set(visible.map((capture) => capture.id)),
    );
  }, [selected.length, visible]);

  const requestDelete = useCallback(() => {
    if (selected.length > 0) {
      setNotice(null);
      setIsConfirming(true);
    }
  }, [selected.length]);

  const cancelDelete = useCallback(() => {
    if (!progress) {
      setIsConfirming(false);
    }
  }, [progress]);

  const confirmDelete = useCallback(async () => {
    if (!userId || progress || selected.length === 0) {
      return;
    }
    const batch = [...selected];
    setProgress({ done: 0, total: batch.length });

    const { deletedIds, failedIds } = await deleteCaptures(client, userId, batch, {
      onProgress: (done, total) => setProgress({ done, total }),
    });

    if (deletedIds.length > 0) {
      onDeleted(deletedIds);
    }
    setProgress(null);
    setIsConfirming(false);
    setNotice(bulkDeleteNotice(deletedIds.length, failedIds.length));
    if (failedIds.length > 0) {
      // Failed rows stay on screen and selected, ready for another try.
      setSelectedIds(new Set(failedIds));
    } else {
      setIsSelecting(false);
      setSelectedIds(new Set());
    }
  }, [client, onDeleted, progress, selected, userId]);

  // Escape leaves select mode (the confirmation sheet handles its own Escape).
  useEffect(() => {
    if (!isSelecting || isConfirming) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        stop();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isConfirming, isSelecting, stop]);

  return {
    cancelDelete,
    confirmDelete,
    dismissNotice: () => setNotice(null),
    isConfirming,
    isSelecting,
    notice,
    progress,
    requestDelete,
    selected,
    selectedIds: effectiveIds,
    start,
    stop,
    toggle,
    toggleAll,
  };
}
