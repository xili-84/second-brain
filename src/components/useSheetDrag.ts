import { useEffect, useRef, type RefObject } from 'react';

/** Dismiss when released past this share of the sheet's height. */
export const DISMISS_FRACTION = 0.3;
/** Downward release speed (px per ms) that counts as a flick: 0.5 px/ms is 500 px/s. */
export const FLICK_VELOCITY = 0.5;
/** Most an upward drag can lift the sheet, approached asymptotically. */
const LIFT_LIMIT = 32;
/** Only movement in this window counts towards the release velocity. */
const VELOCITY_WINDOW_MS = 100;
const SETTLE_MS = 220;

/** Follows the finger downward; upward movement meets growing resistance and never passes LIFT_LIMIT. */
export function dragOffset(deltaY: number) {
  if (deltaY >= 0) {
    return deltaY;
  }
  return -LIFT_LIMIT * (1 - 1 / ((-deltaY * 0.5) / LIFT_LIMIT + 1));
}

/** Release decision: far enough down, or flicked down fast. An upward flick always springs back. */
export function shouldDismiss(offset: number, height: number, velocity: number) {
  if (offset <= 0 || velocity <= -FLICK_VELOCITY) {
    return false;
  }
  return velocity >= FLICK_VELOCITY || offset >= height * DISMISS_FRACTION;
}

function matches(query: string) {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

function prefersReducedMotion() {
  return matches('(prefers-reduced-motion: reduce)');
}

/** On wide screens the sheet is a centred dialog, which is not dragged. */
function isCentredDialog() {
  return matches('(min-width: 48rem)');
}

function isTextEntry(element: Element) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'reset', 'submit'].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** The nearest element between target and panel that can scroll vertically. */
function scrollerFor(target: Element, panel: HTMLElement) {
  for (let node: Element | null = target; node && panel.contains(node); node = node.parentElement) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight) {
      const { overflowY } = window.getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return node;
      }
    }
  }
  return null;
}

type Gesture = {
  height: number;
  mode: 'pending' | 'drag';
  offset: number;
  pointerId: number;
  samples: { t: number; y: number }[];
  scroller: HTMLElement | null;
  startY: number;
};

type SheetDragOptions = {
  /** Whether a drag may dismiss right now; while false the sheet does not move. */
  canDismiss: boolean;
  /** Grab handle: the only place a mouse can start a drag (touch and pen can drag anywhere). */
  handle: RefObject<HTMLElement | null>;
  /** Gets --sheet-drag-progress (0 to 1) so the backdrop can fade with the drag. */
  layer: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  panel: RefObject<HTMLElement | null>;
};

/**
 * Drag-down-to-dismiss for a bottom sheet, built on pointer events.
 *
 * The sheet follows the pointer down and resists being lifted. On release it closes when dragged
 * past DISMISS_FRACTION of its height or flicked down, otherwise it springs back. A drag never
 * starts inside content that is scrolled away from the top, and an upward swipe in scrollable
 * content scrolls it as usual. A non-passive touchmove listener stops the WebView from turning a
 * drag into a scroll (which would cancel the pointer). Moves are applied straight to the DOM so a
 * drag does not re-render React.
 */
export function useSheetDrag({ canDismiss, handle, layer, onDismiss, panel }: SheetDragOptions) {
  const canDismissRef = useRef(canDismiss);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    canDismissRef.current = canDismiss;
    onDismissRef.current = onDismiss;
  }, [canDismiss, onDismiss]);

  useEffect(() => {
    const node = panel.current;
    if (!node) {
      return;
    }
    const sheet: HTMLElement = node;

    let gesture: Gesture | null = null;
    let suppressClickUntil = 0;
    let settleTimer: number | undefined;

    function setOffset(offset: number, height: number) {
      sheet.style.transform = offset === 0 ? '' : `translate3d(0, ${offset}px, 0)`;
      layer.current?.style.setProperty(
        '--sheet-drag-progress',
        String(height > 0 ? Math.min(1, Math.max(0, offset) / height) : 0),
      );
    }

    function settle(offset: number, height: number, done?: () => void) {
      window.clearTimeout(settleTimer);
      const container = layer.current;
      if (prefersReducedMotion()) {
        setOffset(offset, height);
        done?.();
        return;
      }
      container?.classList.add('sheet-layer--settling');
      // Commit the drag position before the transition target, so it animates from there.
      void sheet.offsetHeight;
      setOffset(offset, height);
      settleTimer = window.setTimeout(() => {
        container?.classList.remove('sheet-layer--settling');
        done?.();
      }, SETTLE_MS);
    }

    function springBack(height: number) {
      settle(0, height);
    }

    function dismiss(height: number) {
      settle(height + 16, height, () => {
        onDismissRef.current();
        // If the owner kept the sheet open after all, bring it back into view.
        window.setTimeout(() => {
          if (sheet.isConnected) {
            springBack(height);
          }
        }, 50);
      });
    }

    function startDrag(current: Gesture) {
      current.mode = 'drag';
      window.clearTimeout(settleTimer);
      layer.current?.classList.remove('sheet-layer--settling');
      layer.current?.classList.add('sheet-layer--dragging');
      try {
        sheet.setPointerCapture?.(current.pointerId);
      } catch {
        // The pointer may already be gone; the drag still ends on pointerup or pointercancel.
      }
    }

    function endGesture() {
      layer.current?.classList.remove('sheet-layer--dragging');
      gesture = null;
    }

    function handlePointerDown(event: PointerEvent) {
      gesture = null;
      suppressClickUntil = 0;
      const target = event.target;
      if (
        !canDismissRef.current ||
        !event.isPrimary ||
        isCentredDialog() ||
        !(target instanceof Element) ||
        isTextEntry(target)
      ) {
        return;
      }
      const isMouse = event.pointerType === 'mouse';
      if (isMouse && (event.button !== 0 || !handle.current?.contains(target))) {
        return;
      }

      const scroller = scrollerFor(target, sheet);
      if (scroller && scroller.scrollTop > 0) {
        return;
      }
      if (isMouse) {
        // Keep a mouse drag on the handle from selecting text.
        event.preventDefault();
      }
      gesture = {
        height: sheet.offsetHeight,
        mode: 'pending',
        offset: 0,
        pointerId: event.pointerId,
        samples: [{ t: event.timeStamp, y: event.clientY }],
        scroller,
        startY: event.clientY,
      };
    }

    function handlePointerMove(event: PointerEvent) {
      const current = gesture;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }
      const deltaY = event.clientY - current.startY;

      if (current.mode === 'pending') {
        if (deltaY === 0) {
          return;
        }
        const scroller = current.scroller;
        if (scroller && (deltaY < 0 || scroller.scrollTop > 0)) {
          // Let the content scroll instead.
          gesture = null;
          return;
        }
        startDrag(current);
      }

      current.offset = dragOffset(deltaY);
      current.samples.push({ t: event.timeStamp, y: event.clientY });
      const cutoff = event.timeStamp - VELOCITY_WINDOW_MS;
      while (current.samples.length > 2 && (current.samples[0]?.t ?? cutoff) < cutoff) {
        current.samples.shift();
      }
      setOffset(current.offset, current.height);
    }

    function handlePointerUp(event: PointerEvent) {
      const current = gesture;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }
      endGesture();
      if (current.mode !== 'drag') {
        return;
      }
      // A drag that ends over a button must not also press it.
      suppressClickUntil = performance.now() + 400;

      current.samples.push({ t: event.timeStamp, y: event.clientY });
      const first = current.samples[0];
      const last = current.samples.at(-1);
      const elapsed = first && last ? last.t - first.t : 0;
      const velocity = first && last && elapsed > 0 ? (last.y - first.y) / elapsed : 0;

      if (canDismissRef.current && shouldDismiss(current.offset, current.height, velocity)) {
        dismiss(current.height);
      } else {
        springBack(current.height);
      }
    }

    function handlePointerCancel(event: PointerEvent) {
      const current = gesture;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }
      endGesture();
      if (current.mode === 'drag') {
        springBack(current.height);
      }
    }

    function handleTouchMove(event: TouchEvent) {
      if (gesture?.mode === 'drag' && event.cancelable) {
        event.preventDefault();
      }
    }

    function handleClick(event: MouseEvent) {
      if (suppressClickUntil && performance.now() <= suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
      suppressClickUntil = 0;
    }

    sheet.addEventListener('pointerdown', handlePointerDown);
    sheet.addEventListener('pointermove', handlePointerMove);
    sheet.addEventListener('pointerup', handlePointerUp);
    sheet.addEventListener('pointercancel', handlePointerCancel);
    sheet.addEventListener('touchmove', handleTouchMove, { passive: false });
    sheet.addEventListener('click', handleClick, true);

    return () => {
      window.clearTimeout(settleTimer);
      sheet.removeEventListener('pointerdown', handlePointerDown);
      sheet.removeEventListener('pointermove', handlePointerMove);
      sheet.removeEventListener('pointerup', handlePointerUp);
      sheet.removeEventListener('pointercancel', handlePointerCancel);
      sheet.removeEventListener('touchmove', handleTouchMove);
      sheet.removeEventListener('click', handleClick, true);
    };
  }, [handle, layer, panel]);
}
