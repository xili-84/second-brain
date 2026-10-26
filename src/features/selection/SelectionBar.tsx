import { Trash2 } from 'lucide-react';

type SelectionBarProps = {
  isDeleting: boolean;
  onDelete: () => void;
  onToggleAll: () => void;
  selectedCount: number;
  visibleCount: number;
};

/**
 * Bulk actions for select mode. Pinned above the tab bar on phones (thumb zone), sticky at the
 * bottom of the list column on wide screens.
 */
export function SelectionBar({
  isDeleting,
  onDelete,
  onToggleAll,
  selectedCount,
  visibleCount,
}: SelectionBarProps) {
  const allSelected = visibleCount > 0 && selectedCount === visibleCount;

  return (
    <div aria-label="Selected captures" className="selection-bar glass" role="toolbar">
      <p aria-live="polite" className="selection-bar__count">
        {selectedCount === 0 ? 'None selected' : `${selectedCount} selected`}
      </p>
      <button
        className="btn btn--ghost selection-bar__all"
        disabled={isDeleting || visibleCount === 0}
        onClick={onToggleAll}
        type="button"
      >
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>
      <button
        className="btn btn--danger selection-bar__delete"
        disabled={isDeleting || selectedCount === 0}
        onClick={onDelete}
        type="button"
      >
        <Trash2 aria-hidden="true" className="icon" />
        Delete
      </button>
    </div>
  );
}
