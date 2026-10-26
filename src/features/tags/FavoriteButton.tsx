import { Star } from 'lucide-react';

type FavoriteButtonProps = {
  className?: string;
  disabled?: boolean;
  isFavorite: boolean;
  /** Accessible name; a toggle keeps the same name and reports its state with aria-pressed. */
  label?: string;
  onToggle: () => void;
};

export function FavoriteButton({
  className = 'icon-btn',
  disabled = false,
  isFavorite,
  label = 'Favorite',
  onToggle,
}: FavoriteButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={isFavorite}
      className={isFavorite ? `${className} fav-btn fav-btn--on` : `${className} fav-btn`}
      disabled={disabled}
      onClick={onToggle}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      type="button"
    >
      <Star aria-hidden="true" className="icon" />
    </button>
  );
}
