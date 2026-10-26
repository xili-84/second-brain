import type { SecondBrainClient } from '../../lib/supabase/client';

/**
 * Link previews (title, description, site, image, favicon) are fetched by the `link-preview`
 * Edge Function and stored on the capture. The image lives in its own private bucket and is shown
 * through signed URLs, like image captures, so the Content-Security-Policy needs no new origins.
 *
 * Everything here degrades quietly: before the migration is applied the preview columns are
 * simply not requested, and before the function is deployed links keep their plain row and card.
 */
export const LINK_PREVIEW_BUCKET = 'link-previews';
export const LINK_PREVIEW_FUNCTION = 'link-preview';
export const LINK_PREVIEW_COLUMNS =
  'link_title, link_description, link_site_name, link_image_path, link_favicon, link_preview_status';

export type LinkPreviewFields = {
  link_description?: string | null;
  link_favicon?: string | null;
  link_image_path?: string | null;
  link_preview_status?: string | null;
  link_site_name?: string | null;
  link_title?: string | null;
};

export const emptyPreview: LinkPreviewFields = {};

let previewColumnsMissing = false;

/** For tests: forget that the database lacked the preview columns. */
export function resetLinkPreviewSupport() {
  previewColumnsMissing = false;
}

/** ", link_title, …" to append to a select list, or "" once the columns are known to be absent. */
export function previewSelect() {
  return previewColumnsMissing ? '' : `, ${LINK_PREVIEW_COLUMNS}`;
}

type QueryError = { code?: string; message?: string } | null;

/** PostgREST's answer when a selected column does not exist (migration not applied yet). */
export function isMissingPreviewColumn(error: QueryError) {
  if (!error) return false;
  const mentionsPreview = /link_(title|description|site_name|image_path|favicon|preview)/u.test(
    error.message ?? '',
  );
  return error.code === '42703' || mentionsPreview;
}

/**
 * Runs a select with the preview columns and, if the database does not have them yet, once more
 * without them. The outcome is remembered so later queries skip the failing attempt.
 */
export async function selectWithPreview<T extends { error: QueryError }>(
  run: (extraColumns: string) => PromiseLike<T>,
): Promise<T> {
  const extra = previewSelect();
  const result = await run(extra);
  if (extra && isMissingPreviewColumn(result.error)) {
    previewColumnsMissing = true;
    return run('');
  }
  return result;
}

export function hasLinkPreview(fields: LinkPreviewFields | null | undefined) {
  return Boolean(fields?.link_title || fields?.link_description || fields?.link_image_path);
}

/** Only small raster data URLs are shown (the database enforces the same rule). */
export function safeFavicon(value: string | null | undefined) {
  return value && /^data:image\/(png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/]+=*$/u.test(value)
    ? value
    : null;
}

export function pickPreview(source: LinkPreviewFields | null | undefined): LinkPreviewFields {
  if (!source) return {};
  return {
    link_description: source.link_description ?? null,
    link_favicon: source.link_favicon ?? null,
    link_image_path: source.link_image_path ?? null,
    link_preview_status: source.link_preview_status ?? null,
    link_site_name: source.link_site_name ?? null,
    link_title: source.link_title ?? null,
  };
}

// ---------- Updates between screens ----------

const EVENT = 'second-brain:link-preview';
type PreviewEventDetail = { captureId: string; preview: LinkPreviewFields };

/** Lets an open list or detail view pick up a preview fetched elsewhere (e.g. right after saving). */
export function subscribeToLinkPreviews(listener: (detail: PreviewEventDetail) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<PreviewEventDetail>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

// ---------- Requests ----------

export type PreviewResult =
  { ok: true; preview: LinkPreviewFields } | { ok: false; reason: 'failed' | 'unavailable' };

/**
 * Asks the Edge Function to fetch (or refresh) the preview of one link capture. Never throws.
 * "unavailable" means the feature is not set up yet (function or columns missing).
 */
export async function requestLinkPreview(
  client: SecondBrainClient,
  captureId: string,
): Promise<PreviewResult> {
  if (previewColumnsMissing) {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    const { data, error } = await client.functions.invoke<{ preview?: LinkPreviewFields }>(
      LINK_PREVIEW_FUNCTION,
      { body: { captureId } },
    );
    if (error || !data?.preview) {
      const status = (error as { context?: { status?: number } } | null)?.context?.status;
      return {
        ok: false,
        reason: status === 404 || status === undefined ? 'unavailable' : 'failed',
      };
    }
    const preview = pickPreview(data.preview);
    window.dispatchEvent(
      new CustomEvent<PreviewEventDetail>(EVENT, { detail: { captureId, preview } }),
    );
    return { ok: true, preview };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Removes a capture's preview image. Best effort: a leftover object is private and harmless. */
export async function removeLinkPreviewImage(
  client: SecondBrainClient,
  path: string | null | undefined,
) {
  if (!path) return;
  try {
    await client.storage.from(LINK_PREVIEW_BUCKET).remove([path]);
  } catch {
    // Ignore: deleting the capture matters more than tidying its preview.
  }
}
