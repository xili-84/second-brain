import { useRef } from 'react';

import { Sheet } from '../../components/Sheet';

type BulkDeleteSheetProps = {
  count: number;
  /** Selected captures that hold private files (any type) rather than images. */
  fileCount?: number;
  imageCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  /** Set while deleting: how many of the selection have been handled so far. */
  progress: { done: number; total: number } | null;
};

function captures(count: number) {
  return count === 1 ? '1 capture' : `${count} captures`;
}

/** One confirmation for the whole selection. Cancel has initial focus, so Enter is safe. */
export function BulkDeleteSheet({
  count,
  fileCount = 0,
  imageCount,
  onCancel,
  onConfirm,
  progress,
}: BulkDeleteSheetProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const isDeleting = progress !== null;
  const images =
    imageCount === 0
      ? ''
      : imageCount === 1
        ? ', including 1 private image'
        : `, including ${imageCount} private images`;
  const files =
    fileCount === 0
      ? ''
      : fileCount === 1
        ? `${images ? ' and' : ', including'} 1 capture with private files`
        : `${images ? ' and' : ', including'} ${fileCount} captures with private files`;

  return (
    <Sheet
      canDismiss={!isDeleting}
      describedBy="bulk-delete-text"
      initialFocus={cancelButton}
      labelledBy="bulk-delete-title"
      onClose={() => {
        if (!isDeleting) {
          onCancel();
        }
      }}
      role="alertdialog"
    >
      <h2 className="sheet__title" id="bulk-delete-title">
        Delete {captures(count)}?
      </h2>
      <p className="sheet__text" id="bulk-delete-text">
        {count === 1 ? 'It is' : 'They are'} removed permanently{images}
        {files}. This can’t be undone.
      </p>
      <button
        className="btn btn--danger btn--lg btn--block"
        disabled={isDeleting}
        onClick={onConfirm}
        type="button"
      >
        {progress
          ? `Deleting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
          : `Delete ${captures(count)}`}
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
