import { ExternalLink, Globe, RefreshCw } from 'lucide-react';

import { domainOf } from '../inbox/listFormat';
import { safeFavicon, type LinkPreviewFields } from './linkPreview';
import type { RefreshState } from './useLinkPreview';

type LinkPreviewCardProps = {
  fields: LinkPreviewFields;
  hasPreview: boolean;
  /** The page headline; the card skips a page title that only repeats it. */
  headline?: string | undefined;
  imageUrl: string | null;
  onImageError: () => void;
  onRefresh: () => void;
  refreshState: RefreshState;
  sourceUrl: string;
};

const refreshMessages: Partial<Record<RefreshState, string>> = {
  failed: 'No preview this time. The site may not allow it; the link still works.',
  loading: 'Fetching preview…',
  unavailable: 'Link previews are not available right now.',
};

/**
 * The link on the detail page: a rich card (image, site, title, description) when a preview
 * exists, otherwise the plain domain-and-URL card. Either way the whole card opens the link.
 */
export function LinkPreviewCard({
  fields,
  hasPreview,
  headline,
  imageUrl,
  onImageError,
  onRefresh,
  refreshState,
  sourceUrl,
}: LinkPreviewCardProps) {
  const domain = domainOf(sourceUrl);
  const favicon = safeFavicon(fields.link_favicon);
  const site = fields.link_site_name || domain || 'Open link';
  const message = refreshMessages[refreshState];
  const normalise = (text: string | null | undefined) => text?.trim().toLowerCase() ?? '';
  const cardTitle =
    fields.link_title && normalise(fields.link_title) !== normalise(headline)
      ? fields.link_title
      : null;

  return (
    <>
      {hasPreview ? (
        <a
          className={imageUrl ? 'preview-card preview-card--with-image' : 'preview-card'}
          href={sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          {imageUrl && (
            <span className="preview-card__media">
              <img alt="" decoding="async" onError={onImageError} src={imageUrl} />
            </span>
          )}
          <span className="preview-card__body">
            <span className="preview-card__site">
              {favicon ? (
                <img
                  alt=""
                  className="preview-card__favicon"
                  height="16"
                  src={favicon}
                  width="16"
                />
              ) : (
                <Globe aria-hidden="true" className="icon preview-card__favicon" />
              )}
              <span className="preview-card__site-name">{site}</span>
              <ExternalLink aria-hidden="true" className="icon preview-card__external" />
            </span>
            {cardTitle && <span className="preview-card__title">{cardTitle}</span>}
            {fields.link_description && (
              <span className="preview-card__description">{fields.link_description}</span>
            )}
            <span className="preview-card__url">{sourceUrl}</span>
          </span>
          <span className="visually-hidden">(opens in a new tab)</span>
        </a>
      ) : (
        <a className="link-card" href={sourceUrl} rel="noreferrer" target="_blank">
          <span aria-hidden="true" className="link-card__icon">
            {favicon ? (
              <img alt="" height="20" src={favicon} width="20" />
            ) : (
              <Globe className="icon" />
            )}
          </span>
          <span className="link-card__text">
            <span className="link-card__domain">{domain ?? 'Open link'}</span>
            <span className="link-card__url">{sourceUrl}</span>
          </span>
          <ExternalLink aria-hidden="true" className="icon" />
          <span className="visually-hidden">(opens in a new tab)</span>
        </a>
      )}

      <div className="preview-refresh">
        <button
          className="btn btn--ghost preview-refresh__button"
          disabled={refreshState === 'loading'}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={refreshState === 'loading' ? 'icon icon--spin' : 'icon'}
          />
          {hasPreview ? 'Refresh preview' : 'Get preview'}
        </button>
        <p aria-live="polite" className="preview-refresh__status">
          {message}
        </p>
      </div>
    </>
  );
}
