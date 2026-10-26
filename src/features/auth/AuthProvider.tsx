import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from './authContext';

type AuthProviderProps = {
  children: ReactNode;
  client: SecondBrainClient;
};

export function AuthProvider({ children, client }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!isActive) {
        return;
      }

      setSession(nextSession);
      setError(null);
      setIsRestoring(false);
    });

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!isActive) {
        return;
      }

      if (sessionError) {
        setError('Your saved session could not be restored. Please sign in again.');
        setSession(null);
      } else {
        setSession(data.session);
      }

      setIsRestoring(false);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo(
    () => ({ client, error, isRestoring, session }),
    [client, error, isRestoring, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
