import { describe, expect, it } from 'vitest';

import { readSupabaseEnvironment } from './supabaseEnvironment';

describe('Supabase browser environment', () => {
  it('accepts only the approved browser-safe values', () => {
    expect(
      readSupabaseEnvironment({
        VITE_SUPABASE_URL: 'https://project.supabase.co/',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test-value',
      }),
    ).toEqual({
      url: 'https://project.supabase.co',
      publishableKey: 'public-test-value',
    });
  });

  it('reports every missing value', () => {
    expect(() => readSupabaseEnvironment({})).toThrow(
      'Missing required browser environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY',
    );
  });

  it('rejects an insecure backend URL', () => {
    expect(() =>
      readSupabaseEnvironment({
        VITE_SUPABASE_URL: 'http://project.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test-value',
      }),
    ).toThrow('VITE_SUPABASE_URL must use HTTPS.');
  });
});
