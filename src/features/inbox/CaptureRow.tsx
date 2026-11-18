import { Check, Star, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { SectionState } from '../../app/navigation';
import { FavoriteButton } from '../tags/FavoriteButton';
import { useRowGestures } from './useRowGestures';
import { relativeTime } from './listFormat';

type CaptureRowProps = {
  /** Accessible name of the link, e.g. "Open Reference". */
  accessibleName: string;
  createdAt: string;
  domain?: string | null;
  excerpt?: ReactNode;
  /** A link's favicon (a vetted data URL), shown before the domain. */
  favicon?: string | null;
  /** With onToggle a star button is shown; without it a favorite only gets a small marker. */
  favorite?: { isFavorite: boolean; onToggle?: (() => void) | undefined } | undefined;
  href: string;
  /** Images in an image capture; more than one adds a "+N" badge to the thumbnail. */
  imageCount?: number;
  kind: string;
  /**
   * Undoable delete without opening the capture: swipe left on touch, a hover trash button with a
   * mouse, and a screen-reader-reachable button everywhere.
   */
  onDelete?: (() => void) | undefined;
  /** Long-press starts select mode with this row ticked. */
  onLongPress?: (() => void) | undefined;
  /** A file-type glyph shown in the thumbnail slot instead of a picture (file captures). */
  fileIcon?: ReactNode;
  /** Shows an image slot; `thumbnailUrl` fills it once a signed URL exists. */
  showThumbnail?: boolean;
  /** The section to keep highlighted when the capture opens. */
  section: string;
  /** In select mode the row is one big checkbox instead of a link. */
  selection?: { isSelected: boolean; onToggle: () => void } | undefined;
  status?: string;
  tags?: ReactNode;
  thumbnailUrl?: string | undefined;
  title: ReactNode;
  titleIsUrl?: boolean;
};

/** One editorial list row: headline, optional excerpt, and a kicker/meta line. */
export function CaptureRow({
  accessibleName,
  createdAt,
  domain,
  excerpt,
  favicon,
  favorite,
  fileIcon,
  href,
  imageCount = 0,
  kind,
  onDelete,
  onLongPress,
  section,
  selection,
  showThumbnail = false,
  status,
  tags,
  thumbnailUrl,
  title,
  titleIsUrl = false,
}: CaptureRowProps) {
  const state: SectionState = { section };
  const gestures = useRowGestures({
    onDelete: selection ? undefined : onDelete,
    onLongPress: selection ? undefined : onLongPress,
  });
  const name = accessibleName.replace(/^Open /u, '');

  const content = (
    <>
      <div className="row__main">
        <h3 className={titleIsUrl ? 'row__title row__title--url' : 'row__title'}>{title}</h3>
        {excerpt && <p className="row__excerpt">{excerpt}</p>}
        <p className="row__meta">
          {favorite?.isFavorite && (!favorite.onToggle || selection) && (
            <span className="row__fav-mark" title="Favorite">
              <Star aria-hidden="true" className="icon" />
              <span className="visually-hidden">Favorite</span>
            </span>
          )}
          <span className="kicker">{kind}</span>
          {status && <span className="chip">{status}</span>}
          {domain && (
            <>
              <span aria-hidden="true" className="dot-sep" />
              {favicon && (
                <img alt="" className="row__favicon" height="14" src={favicon} width="14" />
              )}
              <span className="row__domain">{domain}</span>
            </>
          )}
          <span aria-hidden="true" className="dot-sep" />
          <time dateTime={createdAt}>{relativeTime(createdAt)}</time>
        </p>
        {tags}
      </div>
      {fileIcon && (
        <span aria-hidden="true" className="row__thumb row__thumb--file">
          {fileIcon}
        </span>
      )}
      {showThumbnail && (
        <span className="row__thumb">
          {thumbnailUrl && <img alt="" decoding="async" loading="lazy" src={thumbnailUrl} />}
          {imageCount > 1 && (
            <span className="row__thumb-count">
              <span aria-hidden="true">+{imageCount - 1}</span>
              <span className="visually-hidden">{imageCount} images</span>
            </span>
          )}
        </span>
      )}
    </>
  );

  if (selection) {
    return (
      <li
        className={
          selection.isSelected ? 'row row--selectable row--selected' : 'row row--selectable'
        }
      >
        <label className="row__link row__select">
          <input
            aria-label={`Select ${name}`}
            checked={selection.isSelected}
            className="row__check-input"
            onChange={selection.onToggle}
            type="checkbox"
          />
          <span aria-hidden="true" className="row__check">
            <Check className="icon" />
          </span>
          {content}
        </label>
      </li>
    );
  }

  const hasActions = Boolean(favorite?.onToggle || onDelete);
  const isOpen = gestures.offset !== 0;
  const swipeable = Boolean(onDelete || onLongPress);

  return (
    <li
      className={[
        'row',
        swipeable && 'row--swipeable',
        isOpen && 'row--open',
        gestures.removing && 'row--removing',
      ]
        .filter(Boolean)
        .join(' ')}
      data-row-open={isOpen ? 'true' : undefined}
    >
      {onDelete && (
        // The red area revealed by a swipe. Screen readers use the row's own Delete button.
        <div aria-hidden="true" className="row__swipe-action">
          <button
            className="row__swipe-button"
            onClick={gestures.remove}
            tabIndex={-1}
            type="button"
          >
            <Trash2 className="icon" />
            <span>Delete</span>
          </button>
        </div>
      )}
      <div
        className={[
          'row__slide',
          hasActions && 'row--with-action',
          gestures.dragging && 'row__slide--dragging',
        ]
          .filter(Boolean)
          .join(' ')}
        style={isOpen ? { transform: `translate3d(${gestures.offset}px, 0, 0)` } : undefined}
        {...(swipeable ? gestures.handlers : {})}
      >
        <Link aria-label={accessibleName} className="row__link" state={state} to={href}>
          {content}
        </Link>
        {favorite?.onToggle && (
          <FavoriteButton
            className="icon-btn row__fav"
            isFavorite={favorite.isFavorite}
            label={`Favorite: ${name}`}
            onToggle={favorite.onToggle}
          />
        )}
        {onDelete && (
          <button
            aria-label={`Delete ${name}`}
            className="icon-btn row__delete"
            onClick={gestures.remove}
            title="Delete"
            type="button"
          >
            <Trash2 aria-hidden="true" className="icon" />
          </button>
        )}
      </div>
    </li>
  );
}
