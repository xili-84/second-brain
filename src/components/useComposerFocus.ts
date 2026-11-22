import { useEffect, type RefObject } from 'react';

/** Room kept between the sticky top bar and the field's top edge. */
const GAP_PX = 8;

/**
 * Keeps a focused writing field's top edge (and the screen header) in view when the on-screen
 * keyboard opens. Opening the keyboard shrinks the viewport, and some Android WebViews then scroll
 * the page so the end of the tall field is visible, pushing the header and the start of the
 * field off screen. Only acts while the caret is at the very start (a new, empty note), so typing
 * further down a long note still follows the caret.
 */
export function keepFieldTopVisible(field: HTMLTextAreaElement | HTMLInputElement | null) {
  if (!field || document.activeElement !== field) {
    return false;
  }
  if ((field.selectionStart ?? 0) !== 0 || (field.selectionEnd ?? 0) !== 0) {
    return false;
  }
  const header = document.querySelector('.top-bar');
  const headerBottom = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
  const fieldTop = field.getBoundingClientRect().top;
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const hidden =
    fieldTop < headerBottom + viewportTop || (header?.getBoundingClientRect().top ?? 0) < 0;
  if (!hidden) {
    return false;
  }
  window.scrollBy({ top: fieldTop - headerBottom - GAP_PX, behavior: 'instant' as ScrollBehavior });
  return true;
}

/**
 * Focuses the field without scrolling (instead of autoFocus) and, while it stays focused, undoes a
 * keyboard-driven scroll that hid its top. Pass `autoFocus: false` to only guard a field the user
 * taps (the edit form).
 */
export function useComposerFocus(
  ref: RefObject<HTMLTextAreaElement | null>,
  { autoFocus, enabled = true }: { autoFocus: boolean; enabled?: boolean },
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const field = ref.current;
    if (autoFocus && field) {
      field.focus({ preventScroll: true });
    }

    const timers: number[] = [];
    function check() {
      // The WebView scrolls the focused field into view after the resize; correct after it.
      timers.push(window.setTimeout(() => keepFieldTopVisible(ref.current), 60));
      timers.push(window.setTimeout(() => keepFieldTopVisible(ref.current), 300));
    }
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', check);
    window.addEventListener('resize', check);
    return () => {
      viewport?.removeEventListener('resize', check);
      window.removeEventListener('resize', check);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [autoFocus, enabled, ref]);
}
