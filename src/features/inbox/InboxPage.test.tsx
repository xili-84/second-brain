import type { Session } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { InboxPage } from './InboxPage';

describe('Windows inbox', () => {
  it('renders the current user’s newest inbox captures', async () => {
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
          attachments: [{ storage_path: 'user/image-id/attachment.png' }],
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
    const client = {
      from: vi.fn().mockReturnValue({ select }),
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
    expect(screen.queryByText('Remember this')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Private image note that should stay hidden'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Reference' })).toHaveAttribute(
      'href',
      '/captures/link-id',
    );
    expect(eq).toHaveBeenCalledWith('status', 'inbox');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
