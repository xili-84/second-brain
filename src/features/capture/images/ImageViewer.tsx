import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { imageAlt } from './aspect';
import type { GalleryImage } from './ImageGallery';
import { useSwipe } from './useSwipe';

type ImageViewerProps = {
  actions?: (image: GalleryImage, index: number) => ReactNode;
  alt: string;
  images: GalleryImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

/**
 * Full-screen viewer. Arrow keys, the arrow buttons and a horizontal swipe move between images;
 * Escape, the close button or a swipe down close it, and focus returns to what opened it. The
 * backdrop stays dark in both themes, like a photo viewer.
 */
export function ImageViewer({
  actions,
  alt,
  images,
  index,
  onClose,
  onIndexChange,
}: ImageViewerProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const total = images.length;
  const current = images[index];
  const handlers = useRef({ onClose, onIndexChange, index, total });
  handlers.current = { onClose, onIndexChange, index, total };

  const previous = () => index > 0 && onIndexChange(index - 1);
  const next = () => index < total - 1 && onIndexChange(index + 1);
  const swipe = useSwipe({ onDown: onClose, onNext: next, onPrevious: previous });

  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        !!node &&
        !element.contains(node) &&
        !element.hasAttribute('inert'),
    );
    background.forEach((element) => element.setAttribute('inert', ''));
    document.body.classList.add('has-sheet');
    closeButton.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      const state = handlers.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        state.onClose();
      } else if (event.key === 'ArrowLeft' && state.index > 0) {
        event.preventDefault();
        state.onIndexChange(state.index - 1);
      } else if (event.key === 'ArrowRight' && state.index < state.total - 1) {
        event.preventDefault();
        state.onIndexChange(state.index + 1);
      } else if (event.key === 'Tab' && node) {
        const items = Array.from(
          node.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      background.forEach((element) => element.removeAttribute('inert'));
      document.body.classList.remove('has-sheet');
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, []);

  if (!current) {
    return null;
  }

  return createPortal(
    <div
      aria-label={total > 1 ? `Image ${index + 1} of ${total}` : 'Image'}
      aria-modal="true"
      className="viewer"
      ref={dialog}
      role="dialog"
    >
      <div className="viewer__bar">
        <span className="viewer__counter">{total > 1 ? `${index + 1} / ${total}` : ''}</span>
        <span className="viewer__actions">
          {actions?.(current, index)}
          <button
            aria-label="Close"
            className="viewer__btn"
            onClick={onClose}
            ref={closeButton}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" className="icon" />
          </button>
        </span>
      </div>
      <div className="viewer__stage" {...swipe}>
        {current.url ? (
          <img alt={imageAlt(alt, index, total)} className="viewer__image" src={current.url} />
        ) : (
          <span className="viewer__missing">This image could not be loaded.</span>
        )}
      </div>
      {total > 1 && (
        <>
          <button
            aria-label="Previous image"
            className="viewer__btn viewer__nav viewer__nav--prev"
            disabled={index === 0}
            onClick={previous}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="icon" />
          </button>
          <button
            aria-label="Next image"
            className="viewer__btn viewer__nav viewer__nav--next"
            disabled={index === total - 1}
            onClick={next}
            type="button"
          >
            <ChevronRight aria-hidden="true" className="icon" />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
