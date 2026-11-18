import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '../auth/authContext';
import { deleteCapture, type DeletableCapture } from '../capture/deleteCapture';
import type { SecondBrainClient } from '../../lib/supabase/client';
import {
  PendingDeleteContext,
  type DeleteSnackbarState,
  type PendingDeleteItem,
} from './pendingDeleteContext';

/** How long "Item deleted · Undo" stays before the delete becomes real. */
export const UNDO_WINDOW_MS = 5000;

type Pending = { item: PendingDeleteItem; timer: number };

/**
 * Search results do not carry storage paths. Read them (and a link's preview image) right before
 * the delete, so no private object is left behind. Falls back to what the list already had.
 */
async function withStoragePaths(
  client: SecondBrainClient,
  item: PendingDeleteItem,
): Promise<DeletableCapture> {
  const hasFiles = item.kind === 'image' || item.kind === 'file';
  const needsPaths =
    (hasFiles && !item.attachments) || (item.kind === 'link' && item.link_image_path === undefined);
  if (!needsPaths) {
    return item;
  }
  try {
    const { data, error } = await client
      .from('captures')
      .select('id, kind, link_image_path, attachments(storage_path)')
      .eq('id', item.id)
      .single();
    if (error || !data) {
      return item;
    }
    const row = data as unknown as DeletableCapture;
    return { ...item, attachments: row.attachments ?? [], link_image_path: row.link_image_path };
  } catch {
    return item;
  }
}

/**
 * App-wide undoable delete: one pending item at a time, committed on expiry or backgrounding. The
 * shell renders the snackbar (DeleteSnackbarHost) so it can sit above the tab bar.
 */
export function PendingDeleteProvider({ children }: { children: ReactNode }) {
  const { client, session } = useAuth();
  const userId = session?.user.id;
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [snackbar, setSnackbar] = useState<DeleteSnackbarState | null>(null);
  const pending = useRef<Pending | null>(null);
  const errorTimer = useRef<number | null>(null);

  const unhide = useCallback((id: string) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(async () => {
    const current = pending.current;
    if (!current) {
      return;
    }
    pending.current = null;
    window.clearTimeout(current.timer);
    setSnackbar((shown) => (shown?.id === current.item.id ? null : shown));

    const { item } = current;
    const result = userId
      ? await deleteCapture(client, userId, await withStoragePaths(client, item))
      : ({ ok: false } as const);

    if (!result.ok) {
      // Never lose a row silently: it comes back with a short explanation.
      unhide(item.id);
      setSnackbar({
        id: `error-${item.id}`,
        kind: 'error',
        text: `“${item.label}” couldn’t be deleted and is back in the list. Check your connection and try again.`,
      });
      if (errorTimer.current) {
        window.clearTimeout(errorTimer.current);
      }
      errorTimer.current = window.setTimeout(() => setSnackbar(null), UNDO_WINDOW_MS * 2);
    }
  }, [client, unhide, userId]);

  const scheduleDelete = useCallback(
    (item: PendingDeleteItem) => {
      // A second delete makes the first one final right away.
      void commit();
      setHiddenIds((current) => new Set(current).add(item.id));
      pending.current = {
        item,
        timer: window.setTimeout(() => void commit(), UNDO_WINDOW_MS),
      };
      setSnackbar({ id: item.id, kind: 'deleted', text: 'Item deleted' });
    },
    [commit],
  );

  const undo = useCallback(() => {
    const current = pending.current;
    if (!current) {
      return;
    }
    pending.current = null;
    window.clearTimeout(current.timer);
    unhide(current.item.id);
    setSnackbar(null);
  }, [unhide]);

  // Leaving the app (Android home button, closing the tab) makes the pending delete final.
  useEffect(() => {
    function flush() {
      void commit();
    }
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        void commit();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [commit]);

  // After signing out the delete can no longer run; nothing was deleted, so just drop it.
  useEffect(() => {
    if (!userId && pending.current) {
      undo();
    }
  }, [undo, userId]);

  useEffect(
    () => () => {
      if (errorTimer.current) {
        window.clearTimeout(errorTimer.current);
      }
    },
    [],
  );

  const dismissSnackbar = useCallback(() => setSnackbar(null), []);
  const value = useMemo(
    () => ({ dismissSnackbar, hiddenIds, scheduleDelete, snackbar, undo }),
    [dismissSnackbar, hiddenIds, scheduleDelete, snackbar, undo],
  );

  return <PendingDeleteContext.Provider value={value}>{children}</PendingDeleteContext.Provider>;
}
