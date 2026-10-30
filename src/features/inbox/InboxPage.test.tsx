import type { Session } from '@supabase/supabase-js';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { InboxPage } from './InboxPage';

describe('inbox list', () => {
  it('renders the newest inbox captures as rows with previews and one batched thumbnail request', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          attachments: [],
          content: null,
          created_at: '2026-07-24T12:00:00.000Z',
          id: 'link-id',
          kind: 'link',
          source_url: 'https://example.com/reference',
          title: 'Reference',
        },
        {
          attachments: [],
          content: 'Remember this',
          created_at: '2026-07-24T11:00:00.000Z',
          id: 'note-id',
          kind: 'note',
          source_url: null,
          title: 'Long note title',
        },
        {
          attachments: [
            { created_at: '2026-07-24T10:00:00.002Z', storage_path: 'user/image-id/third.png' },
            {
              created_at: '2026-07-24T10:00:00.000Z',
              storage_path: 'user/image-id/attachment.png',
            },
            { created_at: '2026-07-24T10:00:00.001Z', storage_path: 'user/image-id/second.png' },
          ],
          content: 'Private image note that should stay hidden',
          created_at: '2026-07-24T10:00:00.000Z',
          id: 'image-id',
          kind: 'image',
          source_url: null,
          title: 'Receipt',
        },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        {
          error: null,
          path: 'user/image-id/attachment.png',
          signedUrl: 'https://storage.test/signed/attachment.png',
        },
      ],
      error: null,
    });
    const storageFrom = vi.fn().mockReturnValue({ createSignedUrls });
    const client = {
      from: vi.fn().mockReturnValue({ select }),
      storage: { from: storageFrom },
    } as unknown as SecondBrainClient;
    const session = {
      user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' },
    } as unknown as Session;

    render(
      <MemoryRouter>
        <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
          <InboxPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Reference')).toBeVisible();
    expect(screen.getByText('Long note title')).toBeVisible();
    expect(screen.getByText('Receipt')).toBeVisible();
    // Notes show a preview; image notes stay private in lists.
    expect(screen.getByText('Remember this')).toBeVisible();
    expect(
      screen.queryByText('Private image note that should stay hidden'),
    ).not.toBeInTheDocument();

    // Thumbnails are decorative (empty alt) and signed in one batch for the list on screen.
    await waitFor(() =>
      expect(
        document.querySelector('img[src="https://storage.test/signed/attachment.png"]'),
      ).toHaveAttribute('alt', ''),
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(storageFrom).toHaveBeenCalledWith('capture-images');
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    // Only the cover (oldest) image is signed; the rest show as a "+N" badge.
    expect(createSignedUrls).toHaveBeenCalledWith(['user/image-id/attachment.png'], 3600);
    expect(screen.getByText('+2')).toBeVisible();
    expect(screen.getByText('3 images')).toHaveClass('visually-hidden');
    expect(screen.getByRole('link', { name: 'Open Reference' })).toHaveAttribute(
      'href',
      '/captures/link-id',
    );
    expect(select).toHaveBeenCalledWith(
      'id, kind, title, content, source_url, created_at, is_favorite, attachments(storage_path, created_at), capture_tags(tags(id, name)), link_title, link_description, link_site_name, link_image_path, link_favicon, link_preview_status',
    );
    expect(eq).toHaveBeenCalledWith('status', 'inbox');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('does not sign thumbnails while a search is showing', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          attachments: [{ storage_path: 'user/image-id/attachment.png' }],
          content: null,
          created_at: '2026-07-24T10:00:00.000Z',
          id: 'image-id',
          kind: 'image',
          source_url: null,
          title: 'Receipt',
        },
      ],
      error: null,
    });
    const createSignedUrls = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) }),
      }),
      rpc,
      storage: { from: vi.fn().mockReturnValue({ createSignedUrls }) },
    } as unknown as SecondBrainClient;
    const session = {
      user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' },
    } as unknown as Session;

    render(
      <MemoryRouter initialEntries={['/inbox?q=receipt']}>
        <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
          <InboxPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(order).toHaveBeenCalled());
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
