import { describe, expect, it, vi } from 'vitest';

const { registerSW, updateServiceWorker } = vi.hoisted(() => {
  const updater = vi.fn().mockResolvedValue(undefined);

  return {
    registerSW: vi.fn((options?: { onNeedRefresh?: () => void }) => {
      void options;
      return updater;
    }),
    updateServiceWorker: updater,
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('virtual:pwa-register', () => ({ registerSW }));

import { applyPwaUpdate, initializePwaUpdates, subscribeToPwaUpdates } from './pwaUpdate';

describe('PWA updates', () => {
  it('waits for explicit confirmation before activating an update', async () => {
    const listener = vi.fn();

    initializePwaUpdates();
    const unsubscribe = subscribeToPwaUpdates(listener);

    expect(listener).toHaveBeenLastCalledWith(false);
    expect(updateServiceWorker).not.toHaveBeenCalled();

    const options = registerSW.mock.calls[0]?.[0];
    options?.onNeedRefresh?.();

    expect(listener).toHaveBeenLastCalledWith(true);
    expect(updateServiceWorker).not.toHaveBeenCalled();

    await applyPwaUpdate();
    expect(updateServiceWorker).toHaveBeenCalledWith(true);

    unsubscribe();
  });
});
