import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { keepFieldTopVisible, useComposerFocus } from './useComposerFocus';

function rect(top: number, height: number) {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    top,
    width: 0,
    x: 0,
    y: top,
    toJSON() {},
  };
}

function setup({ fieldTop, headerTop = 0 }: { fieldTop: number; headerTop?: number }) {
  document.body.innerHTML = '<div class="top-bar"></div><textarea></textarea>';
  const header = document.querySelector('.top-bar') as HTMLElement;
  const field = document.querySelector('textarea') as HTMLTextAreaElement;
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect(headerTop, 56) as DOMRect);
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(rect(fieldTop, 224) as DOMRect);
  field.focus();
  const scrollBy = vi.fn();
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  return { field, scrollBy };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('keepFieldTopVisible', () => {
  it('scrolls back when the keyboard pushed the start of the note under the header', () => {
    const { field, scrollBy } = setup({ fieldTop: -150 });
    expect(keepFieldTopVisible(field)).toBe(true);
    // Field top ends up 8px below the 56px header.
    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'instant', top: -150 - 56 - 8 });
  });

  it('leaves a field that is already fully below the header alone', () => {
    const { field, scrollBy } = setup({ fieldTop: 190 });
    expect(keepFieldTopVisible(field)).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('follows the caret when typing further down a long note', () => {
    const { field, scrollBy } = setup({ fieldTop: -400 });
    field.value = 'A long note\n'.repeat(40);
    field.setSelectionRange(field.value.length, field.value.length);
    expect(keepFieldTopVisible(field)).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('ignores a field that is not focused', () => {
    const { field, scrollBy } = setup({ fieldTop: -150 });
    field.blur();
    expect(keepFieldTopVisible(field)).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

function Composer({ autoFocus }: { autoFocus: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useComposerFocus(ref, { autoFocus });
  return <textarea aria-label="Note" ref={ref} />;
}

describe('useComposerFocus', () => {
  it('focuses the note without scrolling the page', () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
    render(<Composer autoFocus />);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Note');
  });

  it('does not focus when only guarding a tapped field', () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
    render(<Composer autoFocus={false} />);
    expect(focus).not.toHaveBeenCalled();
  });
});
