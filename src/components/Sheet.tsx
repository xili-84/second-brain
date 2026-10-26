import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { useSheetDrag } from './useSheetDrag';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable elements in order. Like the browser, a radio group counts once: its checked radio. */
function focusableIn(node: HTMLElement) {
  const radios = Array.from(node.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !(
        element instanceof HTMLInputElement &&
        element.type === 'radio' &&
        !element.checked &&
        radios.some((radio) => radio.name === element.name && radio.checked)
      ),
  );
}

type SheetProps = {
  /** False while the sheet must stay open (say, mid-delete): dragging it down does nothing. */
  canDismiss?: boolean;
  children: ReactNode;
  describedBy?: string;
  /** Element to focus when the sheet opens; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  labelledBy: string;
  onClose: () => void;
  role?: 'alertdialog' | 'dialog';
};

/**
 * Modal bottom sheet (a centred dialog on wide screens).
 *
 * Focus moves into the sheet, Tab and Shift+Tab stay inside it, Escape, the backdrop and a drag
 * down from the grab handle or the content (see useSheetDrag) call onClose, and focus returns to
 * the element that opened it. The rest of the page is made inert
 * where the browser supports it and cannot scroll underneath.
 */
export function Sheet({
  canDismiss = true,
  children,
  describedBy,
  initialFocus,
  labelledBy,
  onClose,
  role = 'dialog',
}: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useSheetDrag({ canDismiss, handle, layer, onDismiss: () => onCloseRef.current(), panel });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = panel.current;
    if (!node) {
      return;
    }

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.contains(node) && !element.hasAttribute('inert'),
    );
    background.forEach((element) => element.setAttribute('inert', ''));
    document.body.classList.add('has-sheet');
    (initialFocus?.current ?? focusableIn(node)[0] ?? node).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (!node) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const items = focusableIn(node);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!first || !last) {
        event.preventDefault();
        node.focus();
      } else if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
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
  }, [initialFocus]);

  return createPortal(
    <div className="sheet-layer" ref={layer}>
      <div aria-hidden="true" className="sheet-backdrop" onClick={() => onCloseRef.current()} />
      <div
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className="sheet"
        ref={panel}
        role={role}
        tabIndex={-1}
      >
        <div aria-hidden="true" className="sheet__handle" ref={handle} />
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
