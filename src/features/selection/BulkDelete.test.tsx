import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { createTableClient, type FakeTables } from '../../test/fakeTables';
import { AuthContext } from '../auth/authContext';
import { InboxPage } from '../inbox/InboxPage';
import { bulkDeleteNotice } from './useBulkSelection';

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
    user_id: USER,
    ...extra,
  });
  return {
    capture_tags: [],
    captures: [
      capture('n1', 'Pitch deck', { is_favorite: true }),
      capture('l1', 'Reading list', {
        kind: 'link',
        link_image_path: `${USER}/l1/preview`,
        source_url: 'https://example.com/read',
      }),
      capture('i1', 'Receipt', {
        attachments: [{ storage_path: `${USER}/i1/photo.jpg` }],
        kind: 'image',
      }),
      capture('n2', 'Grocery list'),
    ],
    tags: [],
  };
}

function renderInbox(client: SecondBrainClient) {
  return render(
    <MemoryRouter initialEntries={['/inbox']}>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <InboxPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

async function enterSelectMode() {
  expect(await screen.findByText('Grocery list')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  return screen.getByRole('toolbar', { name: 'Selected captures' });
}

describe('select mode and bulk delete', () => {
  it('ticks rows, selects all and leaves select mode without deleting', async () => {
    const { calls, client } = createTableClient(seed());
    renderInbox(client);
    const bar = await enterSelectMode();

    // Rows turn into checkboxes; links and star buttons are gone while selecting.
    expect(screen.queryByRole('link', { name: 'Open Pitch deck' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Favorite:/u })).not.toBeInTheDocument();
    const deleteButton = within(bar).getByRole('button', { name: 'Delete' });
    expect(deleteButton).toBeDisabled();
    expect(bar).toHaveTextContent('None selected');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Pitch deck' }));
    expect(screen.getByRole('checkbox', { name: 'Select Pitch deck' })).toBeChecked();
    expect(bar).toHaveTextContent('1 selected');
    expect(deleteButton).toBeEnabled();

    fireEvent.click(within(bar).getByRole('button', { name: 'Select all' }));
    expect(bar).toHaveTextContent('4 selected');
    fireEvent.click(within(bar).getByRole('button', { name: 'Deselect all' }));
    expect(bar).toHaveTextContent('None selected');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grocery list' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Grocery list' })).toBeVisible();
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(0);
  });

  it('deletes the selection after one confirmation, cleaning up images and previews', async () => {
    const tables = seed();
    const { bucket, client, storageFrom } = createTableClient(tables);
    vi.mocked(client.rpc).mockResolvedValue({ data: true, error: null } as never);
    renderInbox(client);
    const bar = await enterSelectMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Reading list' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Receipt' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grocery list' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));

    const sheet = screen.getByRole('alertdialog', { name: 'Delete 3 captures?' });
    expect(sheet).toHaveTextContent('including 1 private image');
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete 3 captures' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Deleted 3 captures.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByText('Reading list')).not.toBeInTheDocument();
    expect(screen.queryByText('Receipt')).not.toBeInTheDocument();
    expect(screen.getByText('Pitch deck')).toBeVisible();

    // Same clean-up as a single delete: the preview image and the private photo are removed.
    expect(storageFrom).toHaveBeenCalledWith('link-previews');
    expect(bucket.remove).toHaveBeenCalledWith([`${USER}/l1/preview`]);
    expect(bucket.remove).toHaveBeenCalledWith([`${USER}/i1/photo.jpg`]);
    expect(client.rpc).toHaveBeenCalledWith('delete_image_capture_after_storage', {
      p_capture_id: 'i1',
    });
    expect(tables.captures.map((row) => row.id)).toEqual(['n1', 'i1']);
  });

  it('keeps failed captures visible and selected, and reports how many failed', async () => {
    const { client } = createTableClient(seed(), {}, ({ filters, op }) =>
      op === 'delete' && filters.some(([column, value]) => column === 'id' && value === 'n2')
        ? { message: 'offline' }
        : undefined,
    );
    renderInbox(client);
    const bar = await enterSelectMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Pitch deck' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grocery list' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 captures' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Deleted 1 of 2. 1 capture could not be deleted. It is still selected',
    );
    await waitFor(() => expect(screen.queryByText('Pitch deck')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Select Grocery list' })).toBeChecked();
    expect(screen.getByRole('toolbar')).toHaveTextContent('1 selected');
  });
});

describe('bulkDeleteNotice', () => {
  it('words success, partial and total failure', () => {
    expect(bulkDeleteNotice(1, 0)).toEqual({ text: 'Deleted 1 capture.', tone: 'success' });
    expect(bulkDeleteNotice(0, 3).text).toMatch(/^All 3 captures could not be deleted\. They are/u);
    expect(bulkDeleteNotice(0, 1).text).toMatch(/^The capture could not be deleted\. It is/u);
    expect(bulkDeleteNotice(2, 2).text).toMatch(/^Deleted 2 of 4\. 2 captures could not/u);
  });
});
