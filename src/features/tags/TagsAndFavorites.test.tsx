import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { createTableClient, type FakeTables } from '../../test/fakeTables';
import { AuthContext } from '../auth/authContext';
import { CaptureDetailPage } from '../capture/CaptureDetailPage';
import { QuickCapturePage } from '../capture/QuickCapturePage';
import { InboxPage } from '../inbox/InboxPage';
import { PendingShareContext } from '../share-target/pendingShareContext';

const USER = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const session = { user: { id: USER } } as unknown as Session;

function seed(): FakeTables {
  const capture = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    attachments: [],
    content: null,
    created_at: '2026-10-26T09:00:00.000Z',
    id,
    is_favorite: false,
    kind: 'note',
    source_url: null,
    status: 'inbox',
    title,
    updated_at: '2026-10-26T09:00:00.000Z',
    user_id: USER,
    ...extra,
  });
  return {
    capture_tags: [
      { capture_id: 'c1', tag_id: 't1', user_id: USER },
      { capture_id: 'c2', tag_id: 't1', user_id: USER },
      { capture_id: 'c2', tag_id: 't2', user_id: USER },
    ],
    captures: [
      capture('c1', 'Pitch deck', { is_favorite: true }),
      capture('c2', 'Budget sheet'),
      capture('c3', 'Grocery list'),
    ],
    tags: [
      { id: 't1', name: 'Work', user_id: USER },
      { id: 't2', name: 'Money', user_id: USER },
      { id: 't3', name: 'Travel', user_id: USER },
    ],
  };
}

function renderAt(client: SecondBrainClient, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <PendingShareContext.Provider
          value={{
            clearPendingShare: vi.fn().mockResolvedValue(undefined),
            error: null,
            pendingShare: null,
          }}
        >
          <Routes>
            <Route element={<InboxPage />} path="/inbox" />
            <Route element={<CaptureDetailPage />} path="/captures/:captureId" />
            <Route element={<QuickCapturePage />} path="/capture" />
          </Routes>
        </PendingShareContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('list filters and favorites', () => {
  it('filters by tag and by favorites, and clears filters', async () => {
    const { client } = createTableClient(seed());
    renderAt(client, '/inbox');

    expect(await screen.findByText('Grocery list')).toBeVisible();
    const filters = screen.getByRole('group', { name: 'Filter captures' });
    // Most used tag first; the unused "Travel" tag is not offered.
    expect(
      within(filters)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Favorites', '#Work2', '#Money1']);

    fireEvent.click(within(filters).getByRole('button', { name: 'Tag Work, 2' }));
    expect(within(filters).getByRole('button', { name: 'Tag Work, 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('Grocery list')).not.toBeInTheDocument();
    expect(screen.getByText('2 of 3 items')).toBeVisible();

    fireEvent.click(within(filters).getByRole('button', { name: 'Favorites' }));
    expect(screen.getByText('Pitch deck')).toBeVisible();
    expect(screen.queryByText('Budget sheet')).not.toBeInTheDocument();

    fireEvent.click(within(filters).getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Grocery list')).toBeVisible();
  });

  it('opens with a filter from the address and offers a way out when nothing matches', async () => {
    const { client } = createTableClient(seed());
    renderAt(client, '/inbox?tag=money&fav=1');

    expect(
      await screen.findByRole('heading', { name: 'Nothing matches these filters' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Grocery list')).toBeVisible();
  });

  it('stars a row optimistically and rolls back when saving fails', async () => {
    const tables = seed();
    const ok = createTableClient(tables);
    const { unmount } = renderAt(ok.client, '/inbox');

    const star = await screen.findByRole('button', { name: 'Favorite: Grocery list' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(tables.captures[2]?.is_favorite).toBe(true));
    unmount();

    const failing = createTableClient(seed(), { 'captures.update': { message: 'offline' } });
    renderAt(failing.client, '/inbox');
    const other = await screen.findByRole('button', { name: 'Favorite: Grocery list' });
    fireEvent.click(other);
    expect(await screen.findByRole('alert')).toHaveTextContent('favorite could not be saved');
    expect(other).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('detail tags and favorite', () => {
  it('shows stored tags, adds new and existing ones, and removes them', async () => {
    const tables = seed();
    const { client } = createTableClient(tables);
    renderAt(client, '/captures/c2');

    const chips = await screen.findByRole('list', { name: 'Tags' });
    expect(within(chips).getByText('#Money')).toBeVisible();
    expect(within(chips).getByText('#Work')).toBeVisible();

    const field = screen.getByRole('combobox', { name: 'Add tag' });
    fireEvent.change(field, { target: { value: 'travel' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'Receipts' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(tables.capture_tags).toHaveLength(5));
    expect(screen.getByText('#Travel')).toBeVisible();
    expect(tables.tags.map((tag) => tag.name)).toContain('Receipts');
    // The existing "Travel" tag was reused, not duplicated.
    expect(tables.tags.filter((tag) => String(tag.name).toLowerCase() === 'travel')).toHaveLength(
      1,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Money' }));
    await waitFor(() =>
      expect(
        tables.capture_tags.some((link) => link.capture_id === 'c2' && link.tag_id === 't2'),
      ).toBe(false),
    );
  });

  it('rolls back a tag that could not be added', async () => {
    const { client } = createTableClient(seed(), {
      'capture_tags.insert': { message: 'offline' },
    });
    renderAt(client, '/captures/c3');

    const field = await screen.findByRole('combobox', { name: 'Add tag' });
    fireEvent.change(field, { target: { value: 'Work' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('“Work” could not be added');
    expect(screen.queryByRole('list', { name: 'Tags' })).not.toBeInTheDocument();
  });

  it('toggles the favorite star in the top bar', async () => {
    const tables = seed();
    const { client } = createTableClient(tables);
    renderAt(client, '/captures/c1');

    const star = await screen.findByRole('button', { name: 'Favorite' });
    expect(star).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(tables.captures[0]?.is_favorite).toBe(false));
  });
});

describe('composer tags', () => {
  it('saves the capture first and then attaches its tags', async () => {
    const tables = seed();
    const { calls, client } = createTableClient(tables);
    renderAt(client, '/capture');

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Book flights' },
    });
    const field = screen.getByRole('combobox', { name: 'Add tag' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'tra' } });
    // Existing tags are suggested once the tag list has loaded.
    expect(await screen.findByRole('option', { name: '#Travel' })).toBeVisible();
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByText('Capture saved to your inbox.')).toBeVisible();
    const saved = tables.captures.find((row) => row.content === 'Book flights');
    expect(saved).toBeDefined();
    expect(tables.capture_tags).toContainEqual({
      capture_id: saved?.id,
      tag_id: 't3',
      user_id: USER,
    });
    const writes = calls.filter((call) => call.op === 'insert').map((call) => call.table);
    expect(writes).toEqual(['captures', 'capture_tags']);
  });

  it('keeps the saved capture when its tags fail', async () => {
    const tables = seed();
    const { client } = createTableClient(tables, { 'capture_tags.insert': { message: 'offline' } });
    renderAt(client, '/capture');

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Pack' } });
    const field = screen.getByRole('combobox', { name: 'Add tag' });
    fireEvent.change(field, { target: { value: 'Travel' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Capture saved to your inbox. Some tags could not be added',
    );
    expect(tables.captures.some((row) => row.content === 'Pack')).toBe(true);
    expect(screen.getByRole('button', { name: 'Capture another' })).toBeVisible();
  });
});
