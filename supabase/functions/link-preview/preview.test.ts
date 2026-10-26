// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { fetchLinkPreview, MAX_IMAGE_BYTES } from './preview.ts';
import { PreviewError, type Fetcher } from './ssrf.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const resolve = async (host: string) =>
  host === 'intranet.example' ? ['10.0.0.1'] : ['93.184.215.14'];

function site(routes: Record<string, () => Response>): Fetcher {
  return vi.fn(async (url: string) => routes[url]?.() ?? new Response('missing', { status: 404 }));
}

const article = `<html><head><title>T</title>
  <meta property="og:image" content="https://cdn.example.com/lead.png">
  <meta property="og:site_name" content="Example"></head></html>`;

describe('fetchLinkPreview', () => {
  it('returns metadata, the sniffed image and a favicon data URL', async () => {
    const fetch = site({
      'https://example.com/a': () =>
        new Response(article, { headers: { 'content-type': 'text/html' } }),
      'https://cdn.example.com/lead.png': () =>
        new Response(PNG, { headers: { 'content-type': 'image/png' } }),
      'https://example.com/favicon.ico': () =>
        new Response(new Uint8Array([0, 0, 1, 0, 1, 0]), {
          headers: { 'content-type': 'image/x-icon' },
        }),
    });

    const preview = await fetchLinkPreview('https://example.com/a', { fetch, resolve });
    expect(preview).toMatchObject({
      finalUrl: 'https://example.com/a',
      siteName: 'Example',
      title: 'T',
    });
    expect(preview.image?.type).toBe('image/png');
    expect(preview.favicon).toBe('data:image/x-icon;base64,AAABAAEA');
  });

  it('refuses pages that are not HTML', async () => {
    const fetch = site({
      'https://example.com/file.pdf': () =>
        new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    });
    await expect(
      fetchLinkPreview('https://example.com/file.pdf', { fetch, resolve }),
    ).rejects.toMatchObject({
      code: 'unsupported_type',
    });
  });

  it('refuses error pages', async () => {
    const fetch = site({});
    await expect(
      fetchLinkPreview('https://example.com/gone', { fetch, resolve }),
    ).rejects.toBeInstanceOf(PreviewError);
  });

  it('drops an og:image that points inward, is too big or is not really an image', async () => {
    for (const [imageUrl, response] of [
      ['https://intranet.example/secret.png', () => new Response(PNG)],
      [
        'https://cdn.example.com/huge.png',
        () =>
          new Response(PNG, {
            headers: { 'content-length': String(MAX_IMAGE_BYTES + 1), 'content-type': 'image/png' },
          }),
      ],
      [
        'https://cdn.example.com/fake.png',
        () => new Response('<svg/>', { headers: { 'content-type': 'image/png' } }),
      ],
    ] as const) {
      const fetch = site({
        'https://example.com/a': () =>
          new Response(
            `<head><meta property="og:image" content="${imageUrl}"><title>ok</title></head>`,
            {
              headers: { 'content-type': 'text/html' },
            },
          ),
        [imageUrl]: response,
      });
      const preview = await fetchLinkPreview('https://example.com/a', { fetch, resolve });
      expect(preview.title).toBe('ok');
      expect(preview.image).toBeNull();
    }
  });
});
