import { Notice } from '../../../components/Notice';
import type { StoredImageAttachment } from '../imageReplacement';

function megabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type CaptureImageProps = {
  alt: string;
  attachment: StoredImageAttachment | undefined;
  error: string | null;
  onError: () => void;
  onRetry: () => void;
  url: string | null;
};

/** The private image, edge to edge on phones, or a loading/error notice with Retry. */
export function CaptureImage({ alt, attachment, error, onError, onRetry, url }: CaptureImageProps) {
  if (!url) {
    return (
      <Notice tone={error ? 'error' : 'info'}>
        <span>{error ?? 'Loading private image…'}</span>
        {error && attachment && (
          <button className="btn btn--ghost" onClick={onRetry} type="button">
            Retry
          </button>
        )}
      </Notice>
    );
  }

  return (
    <figure className="article-figure">
      <img alt={alt} onError={onError} src={url} />
      {attachment && (
        <figcaption>
          {attachment.original_name} · {megabytes(attachment.size_bytes)}
        </figcaption>
      )}
    </figure>
  );
}
