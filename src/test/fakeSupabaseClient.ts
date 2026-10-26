import type { Session } from '@supabase/supabase-js';
import { vi } from 'vitest';

import type { SecondBrainClient } from '../lib/supabase/client';

export function createFakeSupabaseClient(session: Session | null = null) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithPassword: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as SecondBrainClient;
}
