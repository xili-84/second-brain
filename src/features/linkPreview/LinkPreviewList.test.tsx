import type { Session } from '@supabase/supabase-js';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { InboxPage } from '../inbox/InboxPage';
import { requestLinkPreview, resetLinkPreviewSupport } from './linkPreview';

const USER = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const LINK_ID = 'c0000000-0000-4000-8000-000000000001';
const FAVICON = 'data:image/png;base64,iVBORw0KGgo=';
const PREVIEW_PATH = `${USER}/${LINK_ID}/preview`;

const session = { user: { id: USER } } as unknown as Session;

function linkRow(extra: Record<string, unknown> = {}) {
  return {
    attachments: [],
    content: null,
    created_at: '2026-10-26T12:00:00.000Z',
    id: LINK_ID,
    kind: 'link',
    source_url: 'https://www.politico.com/news/2026/10/26/story',
    title: null,
    ...extra,
  };
}

function renderInbox(client: SecondBrainClient) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <InboxPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function clientWith(order: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ error: null, path, signedUrl: `https://storage.test/${path}` })),
    error: null,
  }));
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrls });
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) });
  const client = {
    from: vi.fn().mockReturnValue({ select }),
    storage: { from: storageFrom },
    ...extra,
  } as unknown as SecondBrainClient;
  return { client, createSignedUrls, select, storageFrom };
}

afterEach(() => {
  resetLinkPreviewSupport();
});

describe('link previews in the list', () => {
  it('shows the page title, description, site, favicon and a privately signed thumbnail', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        linkRow({
          link_description: 'What happened in Congress today.',
          link_favicon: FAVICON,
          link_image_path: PREVIEW_PATH,
          link_preview_status: 'ready',
          link_site_name: 'POLITICO',
          link_title: 'Senate passes the bill',
        }),
      ],
      error: null,
    });
    const { client, createSignedUrls, storageFrom } = clientWith(order);
    renderInbox(client);

    const row = (await screen.findByRole('link', { name: 'Open Senate passes the bill' })).closest(
      'li',
    )!;
    expect(within(row).getByText('What happened in Congress today.')).toBeVisible();
    expect(within(row).getByText('POLITICO')).toBeVisible();
    expect(row.querySelector(`img[src="${FAVICON}"]`)).not.toBeNull();
    await waitFor(() =>
      expect(row.querySelector(`img[src="https://storage.test/${PREVIEW_PATH}"]`)).toHaveAttribute(
        'alt',
        '',
      ),
    );
    expect(storageFrom).toHaveBeenCalledWith('link-previews');
    expect(storageFrom).not.toHaveBeenCalledWith('capture-images');
    expect(createSignedUrls).toHaveBeenCalledWith([PREVIEW_PATH], 3600);
  });

  it('keeps the plain link row without a preview and never trusts a non-raster favicon', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [linkRow({ link_favicon: 'data:image/svg+xml;base64,PHN2Zz4=' })],
      error: null,
    });
    const { client, createSignedUrls } = clientWith(order);
    renderInbox(client);

    const row = (
      await screen.findByRole('link', {
        name: 'Open https://www.politico.com/news/2026/10/26/story',
      })
    ).closest('li')!;
    expect(within(row).getByText('politico.com')).toBeVisible();
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.row__thumb')).toBeNull();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('still loads the list before the preview migration is applied', async () => {
    const order = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42703', message: 'column captures.link_title does not exist' },
      })
      .mockResolvedValue({ data: [linkRow({ title: 'Saved story' })], error: null });
    const { client, select } = clientWith(order);
    renderInbox(client);

    expect(await screen.findByText('Saved story')).toBeVisible();
    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[1]![0]).not.toContain('link_title');
    // Once known, the preview function is not even called.
    expect(await requestLinkPreview(client, LINK_ID)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('updates an open list as soon as a preview arrives', async () => {
    const order = vi.fn().mockResolvedValue({ data: [linkRow()], error: null });
    const invoke = vi.fn().mockResolvedValue({
      data: { preview: { link_site_name: 'POLITICO', link_title: 'Fresh title' } },
      error: null,
    });
    const { client } = clientWith(order, { functions: { invoke } });
    renderInbox(client);
    await screen.findByText('politico.com/news/2026/10/26/story');

    await act(async () => {
      expect((await requestLinkPreview(client, LINK_ID)).ok).toBe(true);
    });

    expect(invoke).toHaveBeenCalledWith('link-preview', { body: { captureId: LINK_ID } });
    expect(screen.getByRole('link', { name: 'Open Fresh title' })).toBeVisible();
    expect(screen.getByText('POLITICO')).toBeVisible();
  });
});
