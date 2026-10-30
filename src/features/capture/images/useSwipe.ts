import { useRef, type PointerEvent } from 'react';

const SWIPE_PX = 48;

/**
 * Horizontal swipe navigation (and optionally swipe down) from pointer events. A swipe also
 * swallows the click that follows it, so swiping an image never opens it.
 */
export function useSwipe({
  onDown,
  onNext,
  onPrevious,
}: {
  onDown?: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const swiped = useRef(false);

  return {
    onClickCapture(event: { preventDefault: () => void; stopPropagation: () => void }) {
      if (swiped.current) {
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onPointerCancel() {
      start.current = null;
    },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      swiped.current = false;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const origin = start.current;
      start.current = null;
      if (!origin || origin.id !== event.pointerId) {
        return;
      }
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
        swiped.current = true;
        if (dx < 0) {
          onNext();
        } else {
          onPrevious();
        }
      } else if (onDown && dy >= SWIPE_PX * 2 && dy > Math.abs(dx) * 1.5) {
        swiped.current = true;
        onDown();
      }
    },
  };
}
