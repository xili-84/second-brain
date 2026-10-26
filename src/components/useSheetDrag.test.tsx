import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Sheet } from './Sheet';
import { DISMISS_FRACTION, FLICK_VELOCITY, dragOffset, shouldDismiss } from './useSheetDrag';

beforeAll(() => {
  // jsdom has no PointerEvent; a MouseEvent with the pointer fields is enough here. Tests pass
  // timeStamp so release speed is under their control.
  if (typeof window.PointerEvent !== 'function') {
    class PointerEventPolyfill extends MouseEvent {
      isPrimary: boolean;
      pointerId: number;
      pointerType: string;

      constructor(type: string, init: PointerEventInit & { timeStamp?: number } = {}) {
        super(type, init);
        if (init.timeStamp !== undefined) {
          Object.defineProperty(this, 'timeStamp', { value: init.timeStamp });
        }
        this.isPrimary = init.isPrimary ?? true;
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'touch';
      }
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubMedia(queries: string[]) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: queries.includes(query),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function Harness({ canDismiss = true, onClose }: { canDismiss?: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <Sheet
      canDismiss={canDismiss}
      labelledBy="t"
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    >
      <h2 id="t">Account</h2>
      <button type="button">Sign out</button>
    </Sheet>
  ) : null;
}

function setup(canDismiss = true) {
  const onClose = vi.fn();
  render(<Harness canDismiss={canDismiss} onClose={onClose} />);
  const sheet = screen.getByRole('dialog');
  Object.defineProperty(sheet, 'offsetHeight', { configurable: true, value: 400 });
  return { onClose, sheet };
}

/** A drag through the given offsets, one move every `stepMs` (slow by default: no flick). */
function drag(
  target: Element,
  sheet: Element,
  moves: number[],
  { pointerType = 'touch', stepMs = 200 }: { pointerType?: string; stepMs?: number } = {},
) {
  const base = { button: 0, isPrimary: true, pointerId: 7, pointerType };
  let timeStamp = 1000;
  fireEvent.pointerDown(target, { ...base, clientY: 100, timeStamp });
  for (const y of moves) {
    timeStamp += stepMs;
    fireEvent.pointerMove(sheet, { ...base, clientY: 100 + y, timeStamp });
  }
  timeStamp += stepMs;
  fireEvent.pointerUp(sheet, { ...base, clientY: 100 + (moves.at(-1) ?? 0), timeStamp });
}

describe('dragOffset and shouldDismiss', () => {
  it('follows downward movement and resists upward movement', () => {
    expect(dragOffset(120)).toBe(120);
    expect(dragOffset(-40)).toBeLessThan(0);
    expect(dragOffset(-40)).toBeGreaterThan(-40);
    expect(dragOffset(-10_000)).toBeGreaterThan(-32);
  });

  it('dismisses past the distance threshold or on a downward flick', () => {
    expect(shouldDismiss(400 * DISMISS_FRACTION, 400, 0)).toBe(true);
    expect(shouldDismiss(400 * DISMISS_FRACTION - 1, 400, 0)).toBe(false);
    expect(shouldDismiss(20, 400, FLICK_VELOCITY)).toBe(true);
    expect(shouldDismiss(300, 400, -FLICK_VELOCITY)).toBe(false);
    expect(shouldDismiss(-10, 400, FLICK_VELOCITY)).toBe(false);
  });
});

describe('Sheet drag to dismiss', () => {
  it('shows a grab handle that screen readers skip', () => {
    const { sheet } = setup();
    const handle = sheet.querySelector('.sheet__handle');
    expect(handle).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes when dragged down past the threshold (reduced motion: no animation)', () => {
    stubMedia(['(prefers-reduced-motion: reduce)']);
    const { onClose, sheet } = setup();

    drag(screen.getByRole('heading'), sheet, [40, 90, 160]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('animates out, then closes', async () => {
    const { onClose, sheet } = setup();

    drag(screen.getByRole('heading'), sheet, [60, 200]);

    expect(sheet.style.transform).toContain('416px');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('follows the finger and springs back after a short drag', () => {
    stubMedia(['(prefers-reduced-motion: reduce)']);
    const { onClose, sheet } = setup();
    const base = { isPrimary: true, pointerId: 7, pointerType: 'touch' };

    fireEvent.pointerDown(screen.getByRole('heading'), { ...base, clientY: 100, timeStamp: 0 });
    fireEvent.pointerMove(sheet, { ...base, clientY: 150, timeStamp: 300 });
    expect(sheet.style.transform).toBe('translate3d(0, 50px, 0)');
    fireEvent.pointerUp(sheet, { ...base, clientY: 150, timeStamp: 600 });

    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
  });

  it('keeps the WebView from scrolling during a drag, but not before one', () => {
    const { sheet } = setup();
    const base = { isPrimary: true, pointerId: 7, pointerType: 'touch' };

    fireEvent.pointerDown(screen.getByRole('heading'), { ...base, clientY: 100 });
    expect(fireEvent.touchMove(sheet, { cancelable: true })).toBe(true);
    fireEvent.pointerMove(sheet, { ...base, clientY: 120 });
    expect(fireEvent.touchMove(sheet, { cancelable: true })).toBe(false);
  });

  it('closes on a quick downward flick, even a short one', () => {
    stubMedia(['(prefers-reduced-motion: reduce)']);
    const { onClose, sheet } = setup();

    drag(screen.getByRole('heading'), sheet, [20, 40], { stepMs: 16 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not press a button the drag ends on', () => {
    stubMedia(['(prefers-reduced-motion: reduce)']);
    const { onClose, sheet } = setup();
    const button = screen.getByRole('button', { name: 'Sign out' });
    const pressed = vi.fn();
    button.addEventListener('click', pressed);

    drag(button, sheet, [20]);
    fireEvent.click(button);
    expect(pressed).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves scrolled content alone until it is back at the top', () => {
    stubMedia(['(prefers-reduced-motion: reduce)']);
    const { onClose, sheet } = setup();
    const body = sheet.querySelector<HTMLElement>('.sheet__body')!;
    body.style.overflowY = 'auto';
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 });
    body.scrollTop = 120;

    drag(screen.getByRole('heading'), sheet, [100, 250]);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');

    // At the top, swiping up scrolls the content rather than lifting the sheet.
    body.scrollTop = 0;
    drag(screen.getByRole('heading'), sheet, [-30, -60]);
    expect(sheet.style.transform).toBe('');

    // At the top, dragging down moves the sheet.
    drag(screen.getByRole('heading'), sheet, [100, 250]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only lets a mouse drag from the handle', () => {
    stubMedia(['(prefers-reduced-motion: reduce)']);
    const { onClose, sheet } = setup();

    drag(screen.getByRole('heading'), sheet, [200], { pointerType: 'mouse' });
    expect(onClose).not.toHaveBeenCalled();

    drag(sheet.querySelector('.sheet__handle')!, sheet, [200], { pointerType: 'mouse' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays put while it cannot be dismissed', () => {
    stubMedia(['(prefers-reduced-motion: reduce)']);
    const { onClose, sheet } = setup(false);

    drag(screen.getByRole('heading'), sheet, [200]);

    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
  });

  it('is off for the centred dialog on wide screens', () => {
    stubMedia(['(prefers-reduced-motion: reduce)', '(min-width: 48rem)']);
    const { onClose, sheet } = setup();

    drag(screen.getByRole('heading'), sheet, [200]);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('springs back when the pointer is cancelled', async () => {
    const { onClose, sheet } = setup();
    const base = { isPrimary: true, pointerId: 7, pointerType: 'touch' };

    fireEvent.pointerDown(screen.getByRole('heading'), { ...base, clientY: 100 });
    fireEvent.pointerMove(sheet, { ...base, clientY: 300 });
    act(() => {
      fireEvent.pointerCancel(sheet, { ...base, clientY: 300 });
    });

    await waitFor(() => expect(sheet.style.transform).toBe(''));
    expect(onClose).not.toHaveBeenCalled();
  });
});
