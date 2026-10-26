import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  clearPendingNativeShare,
  getPendingNativeShare,
  listenForNativeShares,
  type PendingShare,
} from './nativeShare';
import { PendingShareContext } from './pendingShareContext';

export function PendingShareProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    let removeListener: (() => Promise<void>) | undefined;

    void getPendingNativeShare()
      .then((share) => {
        if (isActive && share) {
          setPendingShare(share);
          navigate('/capture');
        }
      })
      .catch(() => {
        if (isActive) {
          setError('The Android share could not be loaded. Please share it again.');
        }
      });

    void listenForNativeShares((share) => {
      if (isActive) {
        setPendingShare(share);
        setError(null);
        navigate('/capture');
      }
    }).then((handle) => {
      removeListener = handle ? () => handle.remove() : undefined;
    });

    return () => {
      isActive = false;
      void removeListener?.();
    };
  }, [navigate]);

  const clearPendingShare = useCallback(async () => {
    if (!pendingShare) {
      return;
    }

    await clearPendingNativeShare(pendingShare.id);
    setPendingShare(null);
  }, [pendingShare]);

  const value = useMemo(
    () => ({ clearPendingShare, error, pendingShare }),
    [clearPendingShare, error, pendingShare],
  );

  return <PendingShareContext.Provider value={value}>{children}</PendingShareContext.Provider>;
}
