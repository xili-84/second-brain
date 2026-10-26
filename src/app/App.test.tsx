import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { createFakeSupabaseClient } from '../test/fakeSupabaseClient';
import { App } from './App';
import { Masthead } from './Masthead';
import { TabBar } from './TabBar';

describe('application shell', () => {
  it('routes an unauthenticated visitor to private sign-in', async () => {
    window.history.pushState({}, '', '/');

    render(<App client={createFakeSupabaseClient()} />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('highlights the current section in the masthead and the tab bar', () => {
    const onSignOut = vi.fn();
    const onMore = vi.fn();

    render(
      <MemoryRouter initialEntries={['/reviewed']}>
        <Masthead onSignOut={onSignOut} />
        <TabBar onMore={onMore} />
      </MemoryRouter>,
    );

    const [mastheadNav, tabBar] = screen.getAllByRole('navigation', { name: 'Sections' });
    for (const nav of [mastheadNav, tabBar]) {
      expect(within(nav!).getByRole('link', { name: 'Reviewed' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(nav!).getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current');
    }
    expect(screen.getAllByRole('link', { name: 'New capture' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('keeps the section a capture was opened from highlighted', () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/captures/capture-id', state: { section: '/archived' } }]}
      >
        <Masthead onSignOut={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Archived' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers a skip link and names the page in the document title', async () => {
    window.history.pushState({}, '', '/login');

    render(<App client={createFakeSupabaseClient()} />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(document.title).toBe('Sign in · Second Brain');
  });

  it('sends the retired /share URL home without keeping shared values in the address bar', async () => {
    window.history.pushState({}, '', '/share?title=Old&text=Shared+text');

    render(<App client={createFakeSupabaseClient()} />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('');
    expect(screen.queryByText('Shared text')).not.toBeInTheDocument();
  });

  it('opens a signed-in visitor on the inbox', async () => {
    window.history.pushState({}, '', '/');
    const session = { user: { email: 'awa@example.com', id: 'user-id' } } as unknown as Session;
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = Object.assign(createFakeSupabaseClient(session), {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) }),
      }),
    });

    render(<App client={client} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    expect(window.location.pathname).toBe('/inbox');
  });
});
