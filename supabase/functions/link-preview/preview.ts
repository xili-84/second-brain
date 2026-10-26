/**
 * Fetches a page and its preview assets through the SSRF guard. Runtime-neutral: the Edge
 * Function injects Deno's resolver and fetch; tests inject fakes.
 */
import { extractMetadata, decodeHtml, sniffIconType, sniffImageType, toBase64 } from './parse.ts';
import type { ImageType, PageMetadata } from './parse.ts';
import {
  isHtmlType,
  MAX_HTML_BYTES,
  mediaType,
  PreviewError,
  readLimited,
  safeFetch,
} from './ssrf.ts';
import type { Fetcher, Resolver } from './ssrf.ts';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_FAVICON_BYTES = 16 * 1024;
export const PAGE_TIMEOUT_MS = 5000;
export const ASSET_TIMEOUT_MS = 4000;

export type LinkPreview = PageMetadata & {
  favicon: string | null;
  finalUrl: string;
  image: { bytes: Uint8Array; type: ImageType } | null;
};

type Deps = { fetch: Fetcher; resolve: Resolver };

async function fetchImage(url: string, deps: Deps) {
  try {
    const { response, signal } = await safeFetch(url, {
      ...deps,
      accept: 'image/avif;q=0, image/webp, image/png, image/jpeg, image/gif;q=0.8',
      timeoutMs: ASSET_TIMEOUT_MS,
    });
    if (!response.ok || !mediaType(response).startsWith('image/')) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readLimited(response, MAX_IMAGE_BYTES, { signal });
    const type = sniffImageType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null; // A missing image never fails the preview.
  }
}

async function fetchFavicon(urls: string[], deps: Deps) {
  for (const url of urls) {
    try {
      const { response, signal } = await safeFetch(url, {
        ...deps,
        accept: 'image/png, image/x-icon, image/*;q=0.8',
        maxRedirects: 2,
        timeoutMs: ASSET_TIMEOUT_MS,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      const bytes = await readLimited(response, MAX_FAVICON_BYTES, { signal });
      const type = sniffIconType(bytes);
      if (type) return `data:${type};base64,${toBase64(bytes)}`;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function fetchLinkPreview(sourceUrl: string, deps: Deps): Promise<LinkPreview> {
  const { finalUrl, response, signal } = await safeFetch(sourceUrl, {
    ...deps,
    accept: 'text/html, application/xhtml+xml;q=0.9',
    timeoutMs: PAGE_TIMEOUT_MS,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PreviewError('http_error', `The site answered ${response.status}.`);
  }
  if (!isHtmlType(mediaType(response))) {
    await response.body?.cancel().catch(() => undefined);
    throw new PreviewError('unsupported_type', 'The link is not a web page.');
  }
  // Metadata lives in <head>, so a long page is cut at 1 MB rather than refused.
  const bytes = await readLimited(response, MAX_HTML_BYTES, { signal, truncate: true });
  const metadata = extractMetadata(
    decodeHtml(bytes, response.headers.get('content-type')),
    finalUrl,
  );

  const [image, favicon] = await Promise.all([
    metadata.imageUrl ? fetchImage(metadata.imageUrl, deps) : Promise.resolve(null),
    fetchFavicon(metadata.faviconUrls, deps),
  ]);

  return { ...metadata, favicon, finalUrl: finalUrl.href, image };
}
