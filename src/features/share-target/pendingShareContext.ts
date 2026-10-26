import { createContext, useContext } from 'react';

import type { PendingShare } from './nativeShare';

export type PendingShareContextValue = {
  clearPendingShare: () => Promise<void>;
  error: string | null;
  pendingShare: PendingShare | null;
};

export const PendingShareContext = createContext<PendingShareContextValue | null>(null);

export function usePendingShare() {
  const value = useContext(PendingShareContext);

  if (!value) {
    throw new Error('usePendingShare must be used within PendingShareProvider.');
  }

  return value;
}
