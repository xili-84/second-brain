import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { CaptureDetailPage } from '../capture/CaptureDetailPage';
import { resetLinkPreviewSupport } from './linkPreview';

const USER = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const ID = 'c0000000-0000-4000-8000-000000000001';
const PREVIEW_PATH = `${USER}/${ID}/preview`;
const URL_ = 'https://www.politico.com/news/2026/10/26/story';

const baseLink = {
  attachments: [],
  capture_tags: [],
  content: null,
  created_at: '2026-10-26T12:00:00.000Z',
  id: ID,
  is_favorite: false,
  kind: 'link',
  source_url: URL_,
  status: 'inbox',
  title: null,
  updated_at: '2026-10-26T12:00:00.000Z',
};

const withPreview = {
  ...baseLink,
  link_description: 'What happened in Congress today.',
  link_favicon: 'data:image/png;base64,iVBORw0KGgo=',
  link_image_path: PREVIEW_PATH,
  link_preview_status: 'ready',
  link_site_name: 'POLITICO',
  link_title: 'Senate passes the bill',
};

type Result = { data: unknown; error: { code?: string; message: string } | null };

function createClient({
  invoke = vi.fn().mockResolvedValue({ data: null, error: { context: { status: 404 } } }),
  loads = [{ data: withPreview, error: null }] as Result[],
}: { invoke?: ReturnType<typeof vi.fn>; loads?: Result[] } = {}) {
  const calls: string[] = [];
  const selects: string[] = [];
  let loadIndex = 0;
  const from = vi.fn((table: string) => {
    let operation = 'select';
    const builder: Record<string, unknown> = {};
    const chain = (name: string) =>
      vi.fn((...args: unknown[]) => {
        if (name === 'delete' || name === 'update') operation = name;
        if (name === 'select' && table === 'captures' && operation === 'select') {
          selects.push(String(args[0]));
        }
        return builder;
      });
    for (const name of ['select', 'eq', 'order', 'delete', 'update', 'in', 'limit']) {
      builder[name] = chain(name);
    }
    const resolve = (): Result => {
      if (table !== 'captures') return { data: [], error: null };
      if (operation === 'delete') {
        calls.push('delete capture');
        return { data: { id: ID }, error: null };
      }
      const result = loads[Math.min(loadIndex, loads.length - 1)]!;
      loadIndex += 1;
      return result;
    };
    builder.single = vi.fn(() => Promise.resolve(resolve()));
    builder.maybeSingle = builder.single;
    builder.then = (onFulfilled: (value: Result) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled);
    return builder;
  });
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://storage.test/${path}?v=${createSignedUrl.mock.calls.length}` },
    error: null,
  }));
  const remove = vi.fn(async (paths: string[]) => {
    calls.push(`remove ${paths.join(',')}`);
    return { data: [], error: null };
  });
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrl, remove });
  const client = {
    from,
    functions: { invoke },
    storage: { from: storageFrom },
  } as unknown as SecondBrainClient;
  return { calls, client, createSignedUrl, invoke, remove, selects, storageFrom };
}

function renderDetail(client: SecondBrainClient) {
  const session = { access_token: 't', user: { id: USER } } as unknown as Session;
  return render(
    <MemoryRouter initialEntries={[`/captures/${ID}`]}>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <Routes>
          <Route element={<CaptureDetailPage />} path="/captures/:captureId" />
          <Route element={<h1>Inbox destination</h1>} path="/inbox" />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  resetLinkPreviewSupport();
});

describe('link preview on the detail page', () => {
  it('shows a rich card with the privately stored image, and uses the page title as headline', async () => {
    const { client, storageFrom } = createClient();
    renderDetail(client);

    expect(await screen.findByRole('heading', { name: 'Senate passes the bill' })).toBeVisible();
    const card = screen.getByRole('link', { name: /POLITICO/u });
    expect(card).toHaveAttribute('href', URL_);
    expect(card).toHaveAttribute('rel', 'noreferrer');
    expect(card).toHaveTextContent('What happened in Congress today.');
    // The page title already is the headline, so the card does not repeat it.
    expect(card).not.toHaveTextContent('Senate passes the bill');
    await waitFor(() =>
      expect(card.querySelector('.preview-card__media img')).toHaveAttribute(
        'src',
        `https://storage.test/${PREVIEW_PATH}?v=1`,
      ),
    );
    expect(storageFrom).toHaveBeenCalledWith('link-previews');
    expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeEnabled();
  });

  it('drops a preview image that fails to load but keeps the card', async () => {
    const { client } = createClient();
    renderDetail(client);
    const card = await screen.findByRole('link', { name: /POLITICO/u });
    const image = await waitFor(() => {
      const element = card.querySelector('.preview-card__media img');
      expect(element).not.toBeNull();
      return element!;
    });

    fireEvent.error(image);
    expect(card.querySelector('.preview-card__media')).toBeNull();
    expect(card).toHaveTextContent('What happened in Congress today.');
  });

  it('refreshes a preview on request and re-signs the overwritten image', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        preview: { ...withPreview, link_description: 'Updated summary', link_title: 'New title' },
      },
      error: null,
    });
    const { client, createSignedUrl } = createClient({ invoke });
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Senate passes the bill' });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));

    expect(await screen.findByText('Updated summary')).toBeVisible();
    expect(invoke).toHaveBeenCalledWith('link-preview', { body: { captureId: ID } });
    expect(screen.getByRole('heading', { name: 'New title' })).toBeVisible();
    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledTimes(2));
  });

  it('falls back to the plain link card and explains a failed fetch', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { context: { status: 422 } } });
    const { client } = createClient({ invoke, loads: [{ data: baseLink, error: null }] });
    renderDetail(client);

    expect(await screen.findByRole('heading', { name: 'Untitled link' })).toBeVisible();
    expect(screen.getByRole('link', { name: /politico\.com/u })).toHaveAttribute('href', URL_);
    fireEvent.click(screen.getByRole('button', { name: 'Get preview' }));

    expect(await screen.findByText(/No preview this time/u)).toBeVisible();
    expect(document.querySelector('.preview-card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Get preview' })).toBeEnabled();
  });

  it('says so quietly when the preview function is not deployed', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('Failed to send a request'));
    const { client } = createClient({ invoke, loads: [{ data: baseLink, error: null }] });
    renderDetail(client);

    fireEvent.click(await screen.findByRole('button', { name: 'Get preview' }));
    expect(await screen.findByText('Link previews are not available right now.')).toBeVisible();
  });

  it('loads the capture before the preview migration exists', async () => {
    const { client, selects } = createClient({
      loads: [
        {
          data: null,
          error: { code: '42703', message: 'column captures.link_title does not exist' },
        },
        { data: { ...baseLink, title: 'Saved story' }, error: null },
      ],
    });
    renderDetail(client);

    expect(await screen.findByRole('heading', { name: 'Saved story' })).toBeVisible();
    expect(selects[0]).toContain('link_image_path');
    expect(selects[1]).not.toContain('link_');
  });

  it('removes the preview image before deleting the link capture', async () => {
    const { calls, client } = createClient();
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Senate passes the bill' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByRole('heading', { name: 'Inbox destination' })).toBeVisible();
    expect(calls).toEqual([`remove ${PREVIEW_PATH}`, 'delete capture']);
  });
});
