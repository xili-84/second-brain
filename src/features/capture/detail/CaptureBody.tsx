import { ExternalLink, Globe } from 'lucide-react';

import { domainOf } from '../../inbox/listFormat';

type CaptureBodyProps = {
  content: string | null;
  kind: string;
  sourceUrl: string | null;
};

/** The reading view: note text in a comfortable measure, or a card that opens the link. */
export function CaptureBody({ content, kind, sourceUrl }: CaptureBodyProps) {
  if (kind === 'link') {
    return (
      <article aria-label="link content" className="article-body">
        {sourceUrl && (
          <a className="link-card" href={sourceUrl} rel="noreferrer" target="_blank">
            <span aria-hidden="true" className="link-card__icon">
              <Globe className="icon" />
            </span>
            <span className="link-card__text">
              <span className="link-card__domain">{domainOf(sourceUrl) ?? 'Open link'}</span>
              <span className="link-card__url">{sourceUrl}</span>
            </span>
            <ExternalLink aria-hidden="true" className="icon" />
            <span className="visually-hidden">(opens in a new tab)</span>
          </a>
        )}
      </article>
    );
  }

  return (
    <article aria-label={`${kind} content`} className="article-body">
      {content ? (
        <div className="article-body__text">{content}</div>
      ) : (
        <p className="article-body__empty">No note text.</p>
      )}
    </article>
  );
}
