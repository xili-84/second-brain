import type { Session } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';

export type AuthContextValue = {
  client: SecondBrainClient;
  error: string | null;
  isRestoring: boolean;
  session: Session | null;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used within AuthProvider.');
  }

  return value;
}
