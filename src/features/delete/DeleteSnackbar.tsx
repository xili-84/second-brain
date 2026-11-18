import { X } from 'lucide-react';

import { usePendingDelete } from './pendingDeleteContext';

type DeleteSnackbarProps = {
  kind: 'deleted' | 'error';
  onDismiss: () => void;
  onUndo: () => void;
  text: string;
};

/** "Item deleted · Undo" above the tab bar; an error variant explains a delete that came back. */
export function DeleteSnackbar({ kind, onDismiss, onUndo, text }: DeleteSnackbarProps) {
  return (
    <div
      className={kind === 'error' ? 'snackbar snackbar--error' : 'snackbar'}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <p className="snackbar__text">{text}</p>
      {kind === 'deleted' ? (
        <button className="snackbar__action" onClick={onUndo} type="button">
          Undo
        </button>
      ) : (
        <button
          aria-label="Dismiss"
          className="icon-btn snackbar__close"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" className="icon" />
        </button>
      )}
      {kind === 'deleted' && <span aria-hidden="true" className="snackbar__timer" />}
    </div>
  );
}

/** The current snackbar, if any; placed inside the app shell. */
export function DeleteSnackbarHost() {
  const { dismissSnackbar, snackbar, undo } = usePendingDelete();
  if (!snackbar) {
    return null;
  }
  return (
    <DeleteSnackbar
      key={snackbar.id}
      kind={snackbar.kind}
      onDismiss={dismissSnackbar}
      onUndo={undo}
      text={snackbar.text}
    />
  );
}
