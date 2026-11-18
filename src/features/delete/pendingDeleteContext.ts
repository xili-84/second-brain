import { createContext, useContext } from 'react';

import type { DeletableCapture } from '../capture/deleteCapture';

/** What a list hands over for an undoable delete; the provider fills in missing storage paths. */
export type PendingDeleteItem = DeletableCapture & { label: string };

export type DeleteSnackbarState = { id: string; kind: 'deleted' | 'error'; text: string };

export type PendingDeleteValue = {
  dismissSnackbar: () => void;
  /** Rows to hide everywhere: waiting for Undo, or already deleted in this session. */
  hiddenIds: ReadonlySet<string>;
  /** Hides the row now; the real delete runs when the Undo snackbar expires or the app leaves. */
  scheduleDelete: (item: PendingDeleteItem) => void;
  snackbar: DeleteSnackbarState | null;
  undo: () => void;
};

const noop: PendingDeleteValue = {
  dismissSnackbar: () => undefined,
  hiddenIds: new Set(),
  scheduleDelete: () => undefined,
  snackbar: null,
  undo: () => undefined,
};

export const PendingDeleteContext = createContext<PendingDeleteValue>(noop);

export function usePendingDelete() {
  return useContext(PendingDeleteContext);
}
