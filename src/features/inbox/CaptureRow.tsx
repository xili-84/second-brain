import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { SectionState } from '../../app/navigation';
import { relativeTime } from './listFormat';

type CaptureRowProps = {
  /** Accessible name of the link, e.g. "Open Reference". */
  accessibleName: string;
  createdAt: string;
  domain?: string | null;
  excerpt?: ReactNode;
  href: string;
  kind: string;
  /** Shows an image slot; `thumbnailUrl` fills it once a signed URL exists. */
  showThumbnail?: boolean;
  /** The section to keep highlighted when the capture opens. */
  section: string;
  status?: string;
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
  href,
  kind,
  section,
  showThumbnail = false,
  status,
  thumbnailUrl,
  title,
  titleIsUrl = false,
}: CaptureRowProps) {
  const state: SectionState = { section };

  return (
    <li className="row">
      <Link aria-label={accessibleName} className="row__link" state={state} to={href}>
        <div className="row__main">
          <h3 className={titleIsUrl ? 'row__title row__title--url' : 'row__title'}>{title}</h3>
          {excerpt && <p className="row__excerpt">{excerpt}</p>}
          <p className="row__meta">
            <span className="kicker">{kind}</span>
            {status && <span className="chip">{status}</span>}
            {domain && (
              <>
                <span aria-hidden="true" className="dot-sep" />
                <span className="row__domain">{domain}</span>
              </>
            )}
            <span aria-hidden="true" className="dot-sep" />
            <time dateTime={createdAt}>{relativeTime(createdAt)}</time>
          </p>
        </div>
        {showThumbnail && (
          <span className="row__thumb">
            {thumbnailUrl && <img alt="" decoding="async" loading="lazy" src={thumbnailUrl} />}
          </span>
        )}
      </Link>
    </li>
  );
}
