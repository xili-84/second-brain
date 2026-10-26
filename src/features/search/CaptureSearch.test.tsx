import type { Session } from '@supabase/supabase-js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { InboxPage } from '../inbox/InboxPage';
import { resetSearchCapabilityForTests } from './searchCaptures';

const session = { user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' } } as unknown as Session;

const inboxRow = {
  created_at: '2026-10-20T09:00:00.000Z',
  id: 'inbox-1',
  kind: 'note',
  source_url: null,
  title: 'Plain inbox note',
};

function result(overrides: Record<string, unknown>) {
  return {
    content: null,
    created_at: '2026-10-25T09:00:00.000Z',
    kind: 'note',
    rank: 0.1,
    source_url: null,
    status: 'inbox',
    title: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderInbox(rpc: ReturnType<typeof vi.fn>, initialEntry = '/inbox') {
  const order = vi.fn().mockResolvedValue({ data: [inboxRow], error: null });
  const client = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) }),
    }),
    rpc,
  } as unknown as SecondBrainClient;

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <InboxPage />
        <LocationProbe />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

  return { searchBox: screen.getByRole('searchbox', { name: 'Search all captures' }) };
}

const invoiceResults = [
  result({
    content: 'The invoice was paid in full.',
    id: 'archived-1',
    status: 'archived',
    title: 'Invoice March',
  }),
  result({
    id: 'reviewed-1',
    kind: 'link',
    source_url: 'https://example.com/invoices',
    status: 'reviewed',
    title: null,
  }),
];

beforeEach(() => {
  resetSearchCapabilityForTests();
});

describe('capture search', () => {
  it('debounces typing, searches every status and highlights matches', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: invoiceResults, error: null });
    const { searchBox } = renderInbox(rpc);
    expect(await screen.findByText('Plain inbox note')).toBeVisible();

    fireEvent.change(searchBox, { target: { value: 'inv' } });
    fireEvent.change(searchBox, { target: { value: 'invoice' } });
    expect(rpc).not.toHaveBeenCalled();

    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('search_captures', { p_limit: 50, p_query: 'invoice' });
    expect(screen.getByTestId('location')).toHaveTextContent('/inbox?q=invoice');
    expect(await screen.findByText('2 results across all captures')).toBeVisible();
    expect(screen.queryByText('Plain inbox note')).not.toBeInTheDocument();

    const archived = within(results).getByRole('link', { name: 'Open Invoice March (Archived)' });
    expect(archived).toHaveAttribute('href', '/captures/archived-1');
    expect(within(archived).getAllByText(/invoice/iu, { selector: 'mark' })).toHaveLength(2);
    expect(archived).toHaveTextContent('The invoice was paid in full.');
    expect(
      within(results).getByRole('link', {
        name: 'Open https://example.com/invoices (Reviewed)',
      }),
    ).toBeVisible();
  });

  it('only shows the newest search when an older request finishes last', async () => {
    const slow = deferred<{ data: unknown; error: null }>();
    const rpc = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ data: [result({ id: 'new', title: 'Newer match' })], error: null });
    const { searchBox } = renderInbox(rpc);

    fireEvent.change(searchBox, { target: { value: 'old' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    fireEvent.change(searchBox, { target: { value: 'newer' } });
    fireEvent.submit(screen.getByRole('search'));

    expect(await screen.findByText('Newer')).toBeVisible();
    await act(async () => {
      slow.resolve({ data: [result({ id: 'old', title: 'Old match' })], error: null });
      await slow.promise;
    });
    expect(screen.queryByText(/Old match/u)).not.toBeInTheDocument();
  });

  it('shows loading and empty states for a search opened from the URL', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    const rpc = vi.fn().mockReturnValueOnce(pending.promise);
    renderInbox(rpc, '/inbox?q=zebra');

    expect(await screen.findByText('Searching…')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Search results' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await act(async () => {
      pending.resolve({ data: [], error: null });
      await pending.promise;
    });
    expect(await screen.findByText('No captures match “zebra”.')).toBeVisible();

    fireEvent.submit(screen.getByRole('search'));
    // Submitting the unchanged query does not hit the database again.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reports a failed search and retries it', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'timeout' } })
      .mockResolvedValueOnce({ data: [result({ id: 'x', title: 'Recovered' })], error: null });
    renderInbox(rpc, '/inbox?q=zebra');

    expect(await screen.findByRole('alert')).toHaveTextContent('Search failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('supports slash to focus, arrow keys through results and Escape to clear', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: invoiceResults, error: null });
    const { searchBox } = renderInbox(rpc, '/inbox?q=invoice');
    const links = await within(
      await screen.findByRole('list', { name: 'Search results' }),
    ).findAllByRole('link');

    fireEvent.keyDown(document.body, { key: '/' });
    expect(searchBox).toHaveFocus();

    fireEvent.keyDown(searchBox, { key: 'ArrowDown' });
    expect(links[0]).toHaveFocus();
    fireEvent.keyDown(links[0]!, { key: 'ArrowDown' });
    expect(links[1]).toHaveFocus();
    fireEvent.keyDown(links[1]!, { key: 'ArrowDown' });
    expect(links[1]).toHaveFocus();
    fireEvent.keyDown(links[1]!, { key: 'ArrowUp' });
    fireEvent.keyDown(links[0]!, { key: 'ArrowUp' });
    expect(searchBox).toHaveFocus();

    // Typing "/" inside the box is just text.
    fireEvent.keyDown(searchBox, { key: '/' });
    expect(searchBox).toHaveFocus();

    fireEvent.keyDown(searchBox, { key: 'Escape' });
    expect(searchBox).toHaveValue('');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/inbox$/u);
    expect(await screen.findByText('Plain inbox note')).toBeVisible();
  });

  it('keeps image notes private and renders stored markup as text', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        result({
          content: 'secret receipt total',
          id: 'image-1',
          kind: 'image',
          title: 'Photo',
        }),
        result({ id: 'html-1', title: '<img src=x onerror=alert(1)> receipt' }),
      ],
      error: null,
    });
    renderInbox(rpc, '/inbox?q=receipt');

    expect(await screen.findByText('Matches the image note.')).toBeVisible();
    expect(screen.queryByText(/secret/u)).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/u)).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a link by its page title and explains a match in the page description', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        result({
          id: 'link-1',
          kind: 'link',
          link_description: 'Everything about the quarterly budget review.',
          link_title: 'Finance weekly',
          source_url: 'https://news.example.com/a/123',
        }),
      ],
      error: null,
    });
    renderInbox(rpc, '/inbox?q=budget');

    const link = await screen.findByRole('link', { name: 'Open Finance weekly (Inbox)' });
    expect(link).toHaveTextContent('Everything about the quarterly budget review.');
    expect(within(link).getByText('budget', { selector: 'mark' })).toBeVisible();
  });

  it('says that page titles are searched when nothing matches', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    renderInbox(rpc, '/inbox?q=zebra');

    expect(await screen.findByText(/page titles/u)).toBeVisible();
  });
});
