import { Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { SectionState } from '../../app/navigation';
import { FavoriteButton } from '../tags/FavoriteButton';
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
  kind: string;
  /** Shows an image slot; `thumbnailUrl` fills it once a signed URL exists. */
  showThumbnail?: boolean;
  /** The section to keep highlighted when the capture opens. */
  section: string;
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
  href,
  kind,
  section,
  showThumbnail = false,
  status,
  tags,
  thumbnailUrl,
  title,
  titleIsUrl = false,
}: CaptureRowProps) {
  const state: SectionState = { section };

  return (
    <li className={favorite?.onToggle ? 'row row--with-action' : 'row'}>
      <Link aria-label={accessibleName} className="row__link" state={state} to={href}>
        <div className="row__main">
          <h3 className={titleIsUrl ? 'row__title row__title--url' : 'row__title'}>{title}</h3>
          {excerpt && <p className="row__excerpt">{excerpt}</p>}
          <p className="row__meta">
            {favorite?.isFavorite && !favorite.onToggle && (
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
        {showThumbnail && (
          <span className="row__thumb">
            {thumbnailUrl && <img alt="" decoding="async" loading="lazy" src={thumbnailUrl} />}
          </span>
        )}
      </Link>
      {favorite?.onToggle && (
        <FavoriteButton
          className="icon-btn row__fav"
          isFavorite={favorite.isFavorite}
          label={`Favorite: ${accessibleName.replace(/^Open /u, '')}`}
          onToggle={favorite.onToggle}
        />
      )}
    </li>
  );
}
