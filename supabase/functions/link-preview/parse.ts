/**
 * Extracts link-preview metadata from an HTML document without a DOM: the edge runtime has no
 * DOMParser, and only <head> tags matter. Every value is plain text (entities decoded, whitespace
 * collapsed, length capped); the app renders it as text, never as HTML.
 */

export type PageMetadata = {
  description: string | null;
  faviconUrls: string[];
  imageUrl: string | null;
  siteName: string | null;
  title: string | null;
};

export const LIMITS = { description: 600, siteName: 120, title: 300 } as const;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  rsquo: '’',
};

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (
        !Number.isFinite(code) ||
        code <= 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        return match;
      }
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Plain, single-line text, without control characters, capped at `max` characters. */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw)
    .replace(/<[^>]*>/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

/** Parses the attributes of one start tag, e.g. `<meta property="og:title" content="x">`. */
export function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const body = tag.replace(/^<\s*[a-z0-9]+/i, '').replace(/\/?>$/, '');
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1]!.toLowerCase();
    if (!(name in attributes)) {
      attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
  }
  return attributes;
}

/** The part of the document that holds metadata: up to </head> or <body>, comments removed. */
function headOf(html: string) {
  const withoutComments = html.slice(0, 600_000).replace(/<!--[\s\S]*?-->/g, '');
  const end = withoutComments.search(/<\/head\s*>|<body[\s>]/i);
  return end === -1 ? withoutComments : withoutComments.slice(0, end);
}

function resolveHttpUrl(raw: string | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Picks the favicon candidates in order of preference, ending with /favicon.ico. */
function faviconCandidates(links: Record<string, string>[], base: URL) {
  const scored: { href: string; score: number }[] = [];
  for (const link of links) {
    const rel = (link.rel ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
    const href = resolveHttpUrl(link.href, base);
    if (!href) continue;
    const type = (link.type ?? '').toLowerCase();
    const sizes = (link.sizes ?? '').toLowerCase();
    // SVG is a document format: it is not stored, so SVG icons are skipped.
    if (type === 'image/svg+xml' || /\.svgz?(\?|$)/i.test(href)) continue;
    let score = rel.includes('apple-touch-icon') ? 1 : 3;
    if (/\b(16x16|32x32|48x48)\b/.test(sizes)) score += 2;
    scored.push({ href, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const urls = scored.map((item) => item.href);
  urls.push(new URL('/favicon.ico', base).href);
  return [...new Set(urls)].slice(0, 3);
}

export function extractMetadata(html: string, pageUrl: URL): PageMetadata {
  const head = headOf(html);
  const meta = new Map<string, string>();
  const links: Record<string, string>[] = [];
  let base = pageUrl;

  for (const match of head.matchAll(/<(meta|link|base)\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const tag = match[1]!.toLowerCase();
    if (tag === 'meta') {
      const key = (
        attributes.property ??
        attributes.name ??
        attributes.itemprop ??
        ''
      ).toLowerCase();
      if (key && attributes.content !== undefined && !meta.has(key)) {
        meta.set(key, attributes.content);
      }
    } else if (tag === 'link') {
      links.push(attributes);
    } else if (attributes.href) {
      const resolved = resolveHttpUrl(attributes.href, pageUrl);
      if (resolved) base = new URL(resolved);
    }
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  const pick = (...keys: string[]) =>
    keys.map((key) => meta.get(key)).find((value) => value?.trim());

  const imageUrl = resolveHttpUrl(
    pick(
      'og:image:secure_url',
      'og:image',
      'og:image:url',
      'twitter:image',
      'twitter:image:src',
      'image',
    ),
    base,
  );

  return {
    description: cleanText(
      pick('og:description', 'twitter:description', 'description'),
      LIMITS.description,
    ),
    faviconUrls: faviconCandidates(links, base),
    imageUrl,
    siteName: cleanText(
      pick('og:site_name', 'application-name', 'apple-mobile-web-app-title'),
      LIMITS.siteName,
    ),
    title: cleanText(pick('og:title', 'twitter:title') ?? titleTag, LIMITS.title),
  };
}

/** Character set from the Content-Type header, else from <meta charset>, else UTF-8. */
export function detectCharset(contentType: string | null, bytes: Uint8Array) {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const sniff = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(sniff)?.[1] ?? null;
  return (fromMeta ?? 'utf-8').toLowerCase();
}

export function decodeHtml(bytes: Uint8Array, contentType: string | null) {
  const charset = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ---------- Images ----------

export type ImageType = 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';

/** Identifies an image by its magic bytes; the declared Content-Type is not trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return 'image/gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Favicons may also be .ico; SVG is excluded because it is a document format. */
export function sniffIconType(bytes: Uint8Array): ImageType | 'image/x-icon' | null {
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    return 'image/x-icon';
  }
  return sniffImageType(bytes);
}

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
