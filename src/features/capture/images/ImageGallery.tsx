import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Notice } from '../../../components/Notice';
import type { StoredImageAttachment } from '../imageStorage';
import { aspectHint, aspectLabel, imageAlt, megabytes } from './aspect';
import { useSwipe } from './useSwipe';

export type GalleryImage = { attachment: StoredImageAttachment; url: string | null };
export type ImageSize = { height: number; width: number };

type ImageGalleryProps = {
  /** The capture's title; each image's alt text is built from it. */
  alt: string;
  /** Per-image actions (save, download) rendered in the caption of the current image. */
  actions?: (image: GalleryImage, index: number) => ReactNode;
  error: string | null;
  images: GalleryImage[];
  index: number;
  onImageError: (attachmentId: string) => void;
  onIndexChange: (index: number) => void;
  onOpen: (index: number) => void;
  onRetry: () => void;
  onSize: (attachmentId: string, size: ImageSize) => void;
  sizes: Record<string, ImageSize>;
};

/**
 * The images of a capture. Every image is shown whole: the stage takes the shape of the tallest
 * image (up to 70 % of the screen) and the others are letterboxed inside it, so a 9:16 story and
 * a square post both read correctly and swiping between them does not make the page jump.
 */
export function ImageGallery({
  actions,
  alt,
  error,
  images,
  index,
  onImageError,
  onIndexChange,
  onOpen,
  onRetry,
  onSize,
  sizes,
}: ImageGalleryProps) {
  const total = images.length;
  const current = images[index] ?? images[0];
  const swipe = useSwipe({
    onNext: () => onIndexChange(Math.min(total - 1, index + 1)),
    onPrevious: () => onIndexChange(Math.max(0, index - 1)),
  });
  const [focusVisible, setFocusVisible] = useState(false);

  if (!current) {
    return (
      <Notice tone="error">
        <span>This image capture is incomplete. You can delete it and try again.</span>
      </Notice>
    );
  }

  if (images.every((image) => !image.url)) {
    return (
      <Notice tone={error ? 'error' : 'info'}>
        <span>{error ?? (total > 1 ? 'Loading private images…' : 'Loading private image…')}</span>
        {error && (
          <button className="btn btn--ghost" onClick={onRetry} type="button">
            Retry
          </button>
        )}
      </Notice>
    );
  }

  // The stage keeps the shape of the tallest image, so nothing is cropped and nothing jumps.
  const tallest = Object.entries(sizes)
    .filter(([id]) => images.some((image) => image.attachment.id === id))
    .map(([, size]) => size)
    .sort((a, b) => b.height / b.width - a.height / a.width)[0];
  const stageStyle = tallest ? { aspectRatio: `${tallest.width} / ${tallest.height}` } : undefined;
  const currentSize = sizes[current.attachment.id];
  const ratio = aspectLabel(currentSize?.width, currentSize?.height);
  const hint = aspectHint(currentSize?.width, currentSize?.height);

  return (
    <figure
      aria-label={total > 1 ? `${total} images` : undefined}
      className={total > 1 ? 'gallery gallery--multi' : 'gallery'}
      role={total > 1 ? 'group' : undefined}
    >
      <div
        className={focusVisible ? 'gallery__stage gallery__stage--focus' : 'gallery__stage'}
        style={stageStyle}
        {...(total > 1 ? swipe : {})}
      >
        {images.map((image, imageIndex) =>
          image.url ? (
            <img
              alt={imageAlt(alt, imageIndex, total)}
              className="gallery__image"
              decoding="async"
              hidden={imageIndex !== index}
              key={image.attachment.id}
              onClick={() => onOpen(imageIndex)}
              onError={() => onImageError(image.attachment.id)}
              onLoad={(event) =>
                onSize(image.attachment.id, {
                  height: event.currentTarget.naturalHeight,
                  width: event.currentTarget.naturalWidth,
                })
              }
              src={image.url}
            />
          ) : (
            imageIndex === index && (
              <span className="gallery__missing" key={image.attachment.id}>
                {error ?? 'Loading…'}
              </span>
            )
          ),
        )}
        <button
          aria-label="View full screen"
          className="gallery__expand"
          onBlur={() => setFocusVisible(false)}
          onClick={() => onOpen(index)}
          onFocus={() => setFocusVisible(true)}
          title="View full screen"
          type="button"
        >
          <Maximize2 aria-hidden="true" className="icon" />
        </button>
        {total > 1 && (
          <>
            <button
              aria-label="Previous image"
              className="gallery__nav gallery__nav--prev"
              disabled={index === 0}
              onClick={() => onIndexChange(index - 1)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="icon" />
            </button>
            <button
              aria-label="Next image"
              className="gallery__nav gallery__nav--next"
              disabled={index === total - 1}
              onClick={() => onIndexChange(index + 1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="icon" />
            </button>
            <span className="gallery__counter" aria-live="polite">
              {index + 1} / {total}
            </span>
          </>
        )}
      </div>

      {total > 1 && (
        <div aria-label="Choose image" className="gallery__strip" role="group">
          {images.map((image, imageIndex) => {
            const size = sizes[image.attachment.id];
            return (
              <button
                aria-current={imageIndex === index ? 'true' : undefined}
                aria-label={`Show image ${imageIndex + 1} of ${total}`}
                className="gallery__thumb"
                key={image.attachment.id}
                onClick={() => onIndexChange(imageIndex)}
                style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}
                type="button"
              >
                {image.url && <img alt="" decoding="async" src={image.url} />}
              </button>
            );
          })}
        </div>
      )}

      <figcaption className="gallery__caption">
        <span className="gallery__file">
          {current.attachment.original_name} · {megabytes(current.attachment.size_bytes)}
          {ratio && ` · ${[ratio, hint].filter(Boolean).join(' ')}`}
        </span>
        {actions && <span className="gallery__actions">{actions(current, index)}</span>}
      </figcaption>
      {error && images.some((image) => !image.url) && (
        <Notice tone="error">
          <span>{error}</span>
          <button className="btn btn--ghost" onClick={onRetry} type="button">
            Retry
          </button>
        </Notice>
      )}
    </figure>
  );
}
