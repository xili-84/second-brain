// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  cleanText,
  decodeEntities,
  decodeHtml,
  extractMetadata,
  parseAttributes,
  sniffIconType,
  sniffImageType,
} from './parse.ts';

const page = new URL('https://www.example.com/news/story?id=1');

describe('extractMetadata', () => {
  it('prefers Open Graph fields and resolves relative URLs', () => {
    const html = `<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Big &amp; Bold &#8212; a story">
      <meta name="description" content="Plain description">
      <meta property="og:description" content='OG description with "quotes"'>
      <meta property="og:site_name" content="Example News">
      <meta property="og:image" content="/images/lead.jpg">
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel="apple-touch-icon" href="/apple.png">
    </head><body><meta property="og:title" content="ignored body tag"></body></html>`;

    expect(extractMetadata(html, page)).toEqual({
      description: 'OG description with "quotes"',
      faviconUrls: [
        'https://www.example.com/favicon-32.png',
        'https://www.example.com/apple.png',
        'https://www.example.com/favicon.ico',
      ],
      imageUrl: 'https://www.example.com/images/lead.jpg',
      siteName: 'Example News',
      title: 'Big & Bold — a story',
    });
  });

  it('falls back to Twitter tags, <title> and /favicon.ico', () => {
    const html = `<head><TITLE> Only
      a   title </TITLE><meta name="twitter:description" content="tw desc">
      <meta name="twitter:image" content="https://cdn.example.net/x.png"></head>`;
    expect(extractMetadata(html, page)).toMatchObject({
      description: 'tw desc',
      faviconUrls: ['https://www.example.com/favicon.ico'],
      imageUrl: 'https://cdn.example.net/x.png',
      siteName: null,
      title: 'Only a title',
    });
  });

  it('ignores non-http image URLs, SVG icons and commented-out tags', () => {
    const html = `<head>
      <!-- <meta property="og:title" content="commented"> -->
      <meta property="og:image" content="javascript:alert(1)">
      <link rel="icon" href="/icon.svg" type="image/svg+xml">
      <title>Real</title></head>`;
    const metadata = extractMetadata(html, page);
    expect(metadata.title).toBe('Real');
    expect(metadata.imageUrl).toBeNull();
    expect(metadata.faviconUrls).toEqual(['https://www.example.com/favicon.ico']);
  });

  it('honours <base href> for relative URLs', () => {
    const html = `<head><base href="https://static.example.org/assets/"><meta property="og:image" content="a.jpg"></head>`;
    expect(extractMetadata(html, page).imageUrl).toBe('https://static.example.org/assets/a.jpg');
  });

  it('returns plain text only: markup and control characters are stripped and lengths capped', () => {
    const long = 'word '.repeat(400);
    const html = `<head><meta property="og:title" content="&lt;script&gt;alert(1)&lt;/script&gt;Hi\u202e">
      <meta property="og:description" content="${long}"></head>`;
    const metadata = extractMetadata(html, page);
    expect(metadata.title).toBe('alert(1) Hi');
    expect(Array.from(metadata.description!).length).toBeLessThanOrEqual(600);
    expect(metadata.description!.endsWith('…')).toBe(true);
  });
});

describe('helpers', () => {
  it('parses quoted, single-quoted and bare attributes', () => {
    expect(parseAttributes(`<meta property=og:title content='A "b"' data-x>`)).toEqual({
      content: 'A "b"',
      'data-x': '',
      property: 'og:title',
    });
  });

  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(decodeEntities('&amp;&lt;&#39;&#x1F600;&bogus;&#0;')).toBe("&<'😀&bogus;&#0;");
  });

  it('cleans empty values to null', () => {
    expect(cleanText('   ', 10)).toBeNull();
    expect(cleanText(undefined, 10)).toBeNull();
  });

  it('decodes using the declared or meta charset', () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeHtml(latin1, 'text/html; charset=ISO-8859-1')).toBe('café');
    const withMeta = new TextEncoder().encode('<meta charset="utf-8">café');
    expect(decodeHtml(withMeta, 'text/html')).toContain('café');
  });

  it('identifies images by magic bytes, not by the declared type', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(
      sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('<html>'))).toBeNull();
    expect(sniffIconType(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon');
  });
});
