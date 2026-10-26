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
});
