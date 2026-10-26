import { useRef } from 'react';

import { Sheet } from '../../../components/Sheet';

type DeleteSheetProps = {
  isDeleting: boolean;
  isImage: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirmation before a permanent delete. Cancel has initial focus, so Enter is safe. */
export function DeleteSheet({ isDeleting, isImage, onCancel, onConfirm }: DeleteSheetProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  return (
    <Sheet
      canDismiss={!isDeleting}
      describedBy="delete-sheet-text"
      initialFocus={cancelButton}
      labelledBy="delete-sheet-title"
      onClose={() => {
        if (!isDeleting) {
          onCancel();
        }
      }}
      role="alertdialog"
    >
      <h2 className="sheet__title" id="delete-sheet-title">
        Delete this capture?
      </h2>
      <p className="sheet__text" id="delete-sheet-text">
        {isImage
          ? 'The capture and its private image are removed permanently. This can’t be undone.'
          : 'The capture is removed permanently. This can’t be undone.'}
      </p>
      <button
        className="btn btn--danger btn--lg btn--block"
        disabled={isDeleting}
        onClick={onConfirm}
        type="button"
      >
        {isDeleting ? 'Deleting…' : 'Delete permanently'}
      </button>
      <button
        className="btn btn--ghost btn--lg btn--block"
        disabled={isDeleting}
        onClick={onCancel}
        ref={cancelButton}
        type="button"
      >
        Cancel
      </button>
    </Sheet>
  );
}
