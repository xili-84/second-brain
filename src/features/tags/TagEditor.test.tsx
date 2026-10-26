import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { TagEditor } from './TagEditor';
import { tagKey } from './tagNames';

const library = [
  { id: '1', name: 'Design' },
  { id: '2', name: 'Ideas' },
];

function Harness({ initial = [] as string[] }) {
  const [names, setNames] = useState(initial);
  return (
    <TagEditor
      applied={names.map((name) => ({ name }))}
      library={library}
      onAdd={(name) => setNames((current) => [...current, name])}
      onRemove={(name) =>
        setNames((current) => current.filter((item) => tagKey(item) !== tagKey(name)))
      }
    />
  );
}

function input() {
  return screen.getByRole('combobox', { name: 'Add tag' });
}

describe('TagEditor', () => {
  it('adds typed tags with Enter or comma and ignores duplicates', () => {
    render(<Harness />);

    fireEvent.change(input(), { target: { value: '#Read later' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.change(input(), { target: { value: 'read LATER' } });
    fireEvent.keyDown(input(), { key: ',' });

    expect(
      screen.getAllByRole('listitem').filter((item) => item.closest('.tag-editor__chips')),
    ).toHaveLength(1);
    expect(screen.getByText('#Read later')).toBeVisible();
    expect(input()).toHaveValue('');
  });

  it('suggests existing tags and keeps their stored spelling', () => {
    render(<Harness />);

    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'des' } });
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: '#Design' })).toBeVisible();

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: '#Design' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(screen.getByText('#Design')).toBeVisible();
    // A typed name that matches an existing tag also uses the stored spelling.
    fireEvent.change(input(), { target: { value: 'ideas' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByText('#Ideas')).toBeVisible();
  });

  it('removes tags with their button or Backspace in an empty field', () => {
    render(<Harness initial={['Alpha', 'Beta']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Alpha' }));
    expect(screen.queryByText('#Alpha')).not.toBeInTheDocument();

    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(screen.queryByText('#Beta')).not.toBeInTheDocument();
  });

  it('keeps a typed tag when the field loses focus', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'Errands' } });
    fireEvent.blur(input());
    expect(screen.getByText('#Errands')).toBeVisible();
  });
});
