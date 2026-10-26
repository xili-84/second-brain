import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { createFakeSupabaseClient } from '../test/fakeSupabaseClient';
import { App, PrimaryNavigation } from './App';

describe('application shell', () => {
  it('routes an unauthenticated visitor to private sign-in', async () => {
    window.history.pushState({}, '', '/');

    render(<App client={createFakeSupabaseClient()} />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('provides compact, accessible icon navigation', () => {
    const onSignOut = vi.fn();

    render(
      <MemoryRouter initialEntries={['/reviewed']}>
        <PrimaryNavigation onSignOut={onSignOut} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Capture' })).toHaveAttribute('title', 'Capture');
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveAttribute('title', 'Sign out');
    expect(document.querySelectorAll('.nav-icon')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
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
});
