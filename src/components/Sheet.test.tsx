import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Sheet } from './Sheet';

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open sheet
      </button>
      {open && (
        <Sheet
          labelledBy="sheet-title"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <h2 id="sheet-title">Account</h2>
          <button type="button">First</button>
          <button disabled type="button">
            Disabled
          </button>
          <button type="button">Last</button>
        </Sheet>
      )}
    </>
  );
}

function openSheet(onClose = vi.fn()) {
  render(<Harness onClose={onClose} />);
  const trigger = screen.getByRole('button', { name: 'Open sheet' });
  trigger.focus();
  fireEvent.click(trigger);
  return { onClose, trigger };
}

describe('Sheet', () => {
  it('moves focus in, keeps Tab inside and makes the page behind it inert', () => {
    const { trigger } = openSheet();

    expect(screen.getByRole('dialog', { name: 'Account' })).toHaveAttribute('aria-modal', 'true');
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(first).toHaveFocus();
    expect(trigger.closest('[inert]')).not.toBeNull();
    expect(document.body).toHaveClass('has-sheet');

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
  });

  it('closes on Escape and returns focus to the opener', () => {
    const { onClose, trigger } = openSheet();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger.closest('[inert]')).toBeNull();
    expect(document.body).not.toHaveClass('has-sheet');
  });

  it('closes when the backdrop is tapped', () => {
    const { onClose } = openSheet();

    const backdrop = document.querySelector('.sheet-backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
