export type SupabaseEnvironment = {
  url: string;
  publishableKey: string;
};

type EnvironmentSource = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

export function readSupabaseEnvironment(source: EnvironmentSource): SupabaseEnvironment {
  const url = source.VITE_SUPABASE_URL?.trim();
  const publishableKey = source.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const missing: string[] = [];

  if (!url) {
    missing.push('VITE_SUPABASE_URL');
  }

  if (!publishableKey) {
    missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required browser environment variables: ${missing.join(', ')}`);
  }

  // The aggregate check above produces a useful error while this guard gives
  // TypeScript an explicit narrowing boundary.
  if (!url || !publishableKey) {
    throw new Error('Supabase browser environment validation failed.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('VITE_SUPABASE_URL must use HTTPS.');
  }

  return {
    url: parsedUrl.toString().replace(/\/$/, ''),
    publishableKey,
  };
}
