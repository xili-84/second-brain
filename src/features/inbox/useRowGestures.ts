import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

/** Hold this long without moving to start selecting. */
export const LONG_PRESS_MS = 500;
/** Movement before a gesture decides between scrolling and swiping. */
const AXIS_LOCK_PX = 10;
/** Horizontal only when clearly sideways, so a slightly diagonal scroll still scrolls. */
const HORIZONTAL_RATIO = 1.5;
const LONG_PRESS_SLOP_PX = 8;
/** Width of the revealed delete button. */
export const REVEAL_PX = 88;
/** Past this share of the row width, letting go deletes without a second tap. */
const FULL_SWIPE_RATIO = 0.5;
const FLICK_PX_PER_MS = 0.6;

type Options = {
  /** Swipe left to delete (touch and pen only); off in select mode. */
  onDelete?: (() => void) | undefined;
  /** Long-press (touch or mouse) starts select mode with this row. */
  onLongPress?: (() => void) | undefined;
};

type Gesture = {
  axis: 'none' | 'x' | 'y';
  id: number;
  lastT: number;
  lastX: number;
  startOffset: number;
  t: number;
  type: string;
  x: number;
  y: number;
};

/** Only one row may be open at a time; opening one closes the previous. */
let closeOpenRow: (() => void) | null = null;

/**
 * Pointer handling for a list row: long-press to select, and swipe left to reveal or perform
 * delete. A vertical move gives the gesture back to the page scroll (the row has
 * touch-action: pan-y), and any gesture swallows the click that would otherwise open the row.
 */
export function useRowGestures({ onDelete, onLongPress }: Options) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const pressTimer = useRef<number | null>(null);
  const swallowClick = useRef(false);
  const width = useRef(320);
  const close = useCallback(() => setOffset(0), []);

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  useEffect(() => cancelPress, [cancelPress]);

  // An open row closes on any tap elsewhere or when the page scrolls.
  useEffect(() => {
    if (offset === 0 || dragging) {
      return;
    }
    if (closeOpenRow && closeOpenRow !== close) {
      closeOpenRow();
    }
    closeOpenRow = close;
    function handleOutside(event: Event) {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-row-open="true"]')) {
        return;
      }
      close();
    }
    document.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('scroll', close, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('scroll', close);
      if (closeOpenRow === close) {
        closeOpenRow = null;
      }
    };
  }, [close, dragging, offset]);

  const remove = useCallback(() => {
    if (!onDelete) {
      return;
    }
    cancelPress();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setDragging(false);
    setRemoving(true);
    setOffset(-width.current);
    // Let the slide-out play, then hand over; the list hides the row and the snackbar appears.
    window.setTimeout(onDelete, reduced ? 0 : 180);
  }, [cancelPress, onDelete]);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (removing || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    swallowClick.current = false;
    width.current = event.currentTarget.getBoundingClientRect().width || width.current;
    gesture.current = {
      axis: 'none',
      id: event.pointerId,
      lastT: event.timeStamp,
      lastX: event.clientX,
      startOffset: offset,
      t: event.timeStamp,
      type: event.pointerType,
      x: event.clientX,
      y: event.clientY,
    };
    if (onLongPress && offset === 0) {
      cancelPress();
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        gesture.current = null;
        swallowClick.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;

    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) {
      cancelPress();
    }

    if (current.axis === 'none') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) {
        return;
      }
      const canSwipe = Boolean(onDelete) && current.type !== 'mouse';
      current.axis = canSwipe && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO ? 'x' : 'y';
      if (current.axis === 'y') {
        // Scrolling: leave the page alone (an open row snaps closed via the scroll listener).
        gesture.current = null;
        return;
      }
      cancelPress();
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Some test environments have no pointer capture.
      }
    }

    swallowClick.current = true;
    const raw = current.startOffset + dx;
    // Only leftwards; a little resistance past the full width.
    const next =
      raw > 0 ? 0 : raw < -width.current ? -width.current + (raw + width.current) / 4 : raw;
    current.lastT = event.timeStamp;
    current.lastX = event.clientX;
    setOffset(next);
  }

  function finish(event: PointerEvent<HTMLElement>, cancelled: boolean) {
    cancelPress();
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.id !== event.pointerId || current.axis !== 'x') {
      return;
    }
    setDragging(false);
    if (cancelled) {
      setOffset(current.startOffset);
      return;
    }
    const elapsed = Math.max(1, event.timeStamp - current.t);
    const velocity = (event.clientX - current.x) / elapsed;
    const travelled = -(current.startOffset + (event.clientX - current.x));
    if (
      travelled > width.current * FULL_SWIPE_RATIO ||
      (velocity < -FLICK_PX_PER_MS && travelled > REVEAL_PX)
    ) {
      remove();
    } else if (travelled > REVEAL_PX / 2) {
      setOffset(-REVEAL_PX);
    } else {
      setOffset(0);
    }
  }

  return {
    close,
    dragging,
    handlers: {
      onClickCapture(event: { preventDefault: () => void; stopPropagation: () => void }) {
        if (swallowClick.current || offset !== 0) {
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
          if (offset !== 0 && !dragging) {
            close();
          }
        }
      },
      // Android WebView opens a link menu on long-press; the row's own long-press replaces it.
      onContextMenu(event: { preventDefault: () => void }) {
        if (onLongPress) {
          event.preventDefault();
        }
      },
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
    },
    offset,
    remove,
    removing,
  };
}
