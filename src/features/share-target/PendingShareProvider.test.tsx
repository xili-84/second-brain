import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { getPendingNativeShare, listenForNativeShares } from './nativeShare';
import { PendingShareProvider } from './PendingShareProvider';

vi.mock('./nativeShare', () => ({
  clearPendingNativeShare: vi.fn(),
  getPendingNativeShare: vi.fn(),
  listenForNativeShares: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('pending share provider', () => {
  it('removes a native listener that finishes registering after unmount', async () => {
    const registration = deferred<{ remove: () => Promise<void> }>();
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getPendingNativeShare).mockResolvedValue(null);
    vi.mocked(listenForNativeShares).mockReturnValue(
      registration.promise as ReturnType<typeof listenForNativeShares>,
    );

    const view = render(
      <MemoryRouter>
        <PendingShareProvider>
          <p>child</p>
        </PendingShareProvider>
      </MemoryRouter>,
    );
    view.unmount();
    registration.resolve({ remove });
    await registration.promise;
    await Promise.resolve();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('removes a registered listener on unmount', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getPendingNativeShare).mockResolvedValue(null);
    vi.mocked(listenForNativeShares).mockResolvedValue({ remove } as unknown as Awaited<
      ReturnType<typeof listenForNativeShares>
    >);

    const view = render(
      <MemoryRouter>
        <PendingShareProvider>
          <p>child</p>
        </PendingShareProvider>
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    view.unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
