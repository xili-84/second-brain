import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../../app/App';
import { createFakeSupabaseClient } from '../../test/fakeSupabaseClient';

describe('GET share diagnostic', () => {
  it('shows received fields without claiming persistence', () => {
    window.history.pushState(
      {},
      '',
      '/share?title=Harmless+test&text=Shared+from+the+phone&url=https%3A%2F%2Fexample.com',
    );

    render(<App client={createFakeSupabaseClient()} />);

    expect(screen.getByRole('heading', { name: 'Share received' })).toBeVisible();
    expect(screen.getByText('Harmless test')).toBeVisible();
    expect(screen.getByText('Shared from the phone')).toBeVisible();
    expect(screen.getByText('https://example.com')).toBeVisible();
    expect(screen.queryByText(/^saved$/i)).not.toBeInTheDocument();
  });

  it('does not report receipt when no fields are present', () => {
    window.history.pushState({}, '', '/share');

    render(<App client={createFakeSupabaseClient()} />);

    expect(screen.getByRole('heading', { name: 'No shared content received' })).toBeVisible();
  });
});
