import type { ComponentProps } from 'react';

import { LinkPreviewCard } from '../../linkPreview/LinkPreviewCard';

type CaptureBodyProps = {
  content: string | null;
  kind: string;
  /** Link captures: preview fields and actions for the link card. */
  linkPreview?: Omit<ComponentProps<typeof LinkPreviewCard>, 'sourceUrl'> | undefined;
  sourceUrl: string | null;
};

/** The reading view: note text in a comfortable measure, or a card that opens the link. */
export function CaptureBody({ content, kind, linkPreview, sourceUrl }: CaptureBodyProps) {
  if (kind === 'link') {
    return (
      <article aria-label="link content" className="article-body">
        {sourceUrl && (
          <LinkPreviewCard
            fields={linkPreview?.fields ?? {}}
            hasPreview={linkPreview?.hasPreview ?? false}
            headline={linkPreview?.headline}
            imageUrl={linkPreview?.imageUrl ?? null}
            onImageError={linkPreview?.onImageError ?? noop}
            onRefresh={linkPreview?.onRefresh ?? noop}
            refreshState={linkPreview?.refreshState ?? 'idle'}
            sourceUrl={sourceUrl}
          />
        )}
      </article>
    );
  }

  // A file capture is its files; an empty note line under them would only say "nothing here".
  if (kind === 'file' && !content) {
    return null;
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

function noop() {}
