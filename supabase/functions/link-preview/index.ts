/**
 * link-preview Edge Function.
 *
 * POST { "captureId": "<uuid>" } with the signed-in user's access token. The function:
 * 1. verifies the token with Supabase Auth (it never uses the service-role key);
 * 2. reads the capture's link through the user's own Row Level Security;
 * 3. fetches the page through the SSRF guard in ssrf.ts and parses its metadata;
 * 4. stores the og:image in the private `link-previews` bucket under <user id>/<capture id>/,
 *    so the app shows it through short-lived signed URLs and the CSP stays unchanged;
 * 5. saves the text fields and a small favicon data URL on the capture.
 *
 * Failures are recorded as link_preview_status = 'failed'; the app then shows the plain link.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

import { fetchLinkPreview } from './preview.ts';
import { PreviewError } from './ssrf.ts';

const PREVIEW_BUCKET = 'link-previews';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-origin': '*',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'cache-control': 'no-store', 'content-type': 'application/json' },
    status,
  });
}

async function resolveHost(hostname: string): Promise<string[]> {
  const lookups = await Promise.allSettled([
    Deno.resolveDns(hostname, 'A'),
    Deno.resolveDns(hostname, 'AAAA'),
  ]);
  const addresses = lookups.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  if (addresses.length === 0) throw new Error('No addresses.');
  return addresses;
}

/** The project's publishable key (new API keys), else the legacy anon key. Never a secret key. */
function publishableKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<
      string,
      string
    >;
    if (keys.default) return keys.default;
  } catch {
    // Fall through to the legacy variable.
  }
  return Deno.env.get('SUPABASE_ANON_KEY');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!token) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const apiKey = publishableKey();
  if (!supabaseUrl || !apiKey) return json({ error: 'not_configured' }, 500);

  // A client that acts as the caller: every query below is limited by their RLS policies.
  const supabase = createClient(supabaseUrl, apiKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: 'unauthorized' }, 401);

  let captureId: unknown;
  try {
    captureId = ((await request.json()) as { captureId?: unknown }).captureId;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof captureId !== 'string' || !UUID.test(captureId)) {
    return json({ error: 'bad_request' }, 400);
  }

  const { data: capture, error: captureError } = await supabase
    .from('captures')
    .select('id, kind, source_url, link_image_path')
    .eq('id', captureId)
    .maybeSingle();
  if (captureError) return json({ error: 'lookup_failed' }, 500);
  if (!capture || capture.kind !== 'link' || !capture.source_url) {
    return json({ error: 'not_found' }, 404);
  }

  const fetchedAt = new Date().toISOString();
  try {
    const preview = await fetchLinkPreview(capture.source_url, {
      fetch: (input, init) => fetch(input, init),
      resolve: resolveHost,
    });

    // One object per capture, overwritten on refresh, so nothing is left behind.
    const imagePath = `${user.id}/${captureId}/preview`;
    let storedImagePath: string | null = null;
    if (preview.image) {
      const { error } = await supabase.storage
        .from(PREVIEW_BUCKET)
        .upload(imagePath, preview.image.bytes, {
          cacheControl: '3600',
          contentType: preview.image.type,
          upsert: true,
        });
      if (!error) storedImagePath = imagePath;
    }
    if (!storedImagePath && capture.link_image_path) {
      await supabase.storage.from(PREVIEW_BUCKET).remove([capture.link_image_path]);
    }

    const fields = {
      link_description: preview.description,
      link_favicon: preview.favicon,
      link_image_path: storedImagePath,
      link_preview_fetched_at: fetchedAt,
      link_preview_status: 'ready',
      link_site_name: preview.siteName,
      link_title: preview.title,
    };
    const { error: updateError } = await supabase
      .from('captures')
      .update(fields)
      .eq('id', captureId);
    if (updateError) return json({ error: 'save_failed' }, 500);

    return json({ preview: fields });
  } catch (error) {
    const code = error instanceof PreviewError ? error.code : 'network';
    const message =
      error instanceof PreviewError ? error.message : 'The page could not be fetched.';
    // Keep any earlier preview; only note that this attempt failed.
    await supabase
      .from('captures')
      .update({ link_preview_fetched_at: fetchedAt, link_preview_status: 'failed' })
      .eq('id', captureId);
    return json({ error: code, message }, 422);
  }
});
