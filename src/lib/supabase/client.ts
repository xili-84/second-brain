import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  readSupabaseEnvironment,
  type SupabaseEnvironment,
} from '../environment/supabaseEnvironment';
import type { Database } from './database.types';

export type SecondBrainClient = SupabaseClient<Database>;

export function createSecondBrainClient(environment: SupabaseEnvironment): SecondBrainClient {
  return createClient<Database>(environment.url, environment.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export function createSecondBrainClientFromBrowserEnvironment(): SecondBrainClient {
  return createSecondBrainClient(readSupabaseEnvironment(import.meta.env));
}
