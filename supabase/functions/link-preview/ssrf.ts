/**
 * Server-side request forgery guard for link previews.
 *
 * Every hop (the first request and each redirect) is checked before it is fetched:
 * - only http and https, on the usual web ports, with no credentials in the URL;
 * - the host name is resolved and every address must be public unicast; private, loopback,
 *   link-local, carrier-grade NAT, multicast, documentation and other reserved ranges are refused,
 *   including IPv4-mapped, NAT64 and 6to4 IPv6 forms that embed a private IPv4 address;
 * - at most three redirects, followed by hand (redirect: 'manual');
 * - one deadline for the whole chain, a byte cap on the body, and a content-type allow-list;
 * - no cookies or credentials are sent, and none are forwarded from the caller.
 *
 * Residual risk: fetch() resolves the name again, so a DNS rebinding attacker with a very short TTL
 * could answer differently between our check and the connection. The edge runtime cannot pin an
 * address; the impact is limited because the function never returns the body, only parsed text
 * fields and an image that must decode as an image.
 *
 * This module has no runtime-specific imports so it runs under Deno (the Edge Function) and under
 * Vitest (unit tests) alike.
 */

export type Resolver = (hostname: string) => Promise<string[]>;
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class PreviewError extends Error {
  constructor(
    readonly code:
      | 'bad_url'
      | 'blocked_address'
      | 'dns_failed'
      | 'too_many_redirects'
      | 'timeout'
      | 'http_error'
      | 'unsupported_type'
      | 'too_large'
      | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'PreviewError';
  }
}

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
export const MAX_REDIRECTS = 3;
export const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_HTML_BYTES = 1024 * 1024;

// ---------- IP classification ----------

export function parseIpv4(input: string): number[] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

/** Parses an IPv6 address (no zone id) into eight 16-bit groups. */
export function parseIpv6(input: string): number[] | null {
  let text = input.toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (text.includes('%') || !text.includes(':')) return null;

  // A trailing dotted IPv4 part becomes two groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    text =
      text.slice(0, lastColon + 1) +
      ((v4[0]! << 8) | v4[1]!).toString(16) +
      ':' +
      ((v4[2]! << 8) | v4[3]!).toString(16);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups: number[] = [];
  for (const group of [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...rest,
  ]) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  return groups;
}

function inV4(bytes: number[], base: [number, number, number, number], prefix: number) {
  const value = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const net = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (net & mask);
}

const BLOCKED_V4: [[number, number, number, number], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved and broadcast
];

export function isPublicIpv4(bytes: number[]) {
  return !BLOCKED_V4.some(([base, prefix]) => inV4(bytes, base, prefix));
}

function embeddedV4(groups: number[], from: number) {
  return [
    groups[from]! >> 8,
    groups[from]! & 0xff,
    groups[from + 1]! >> 8,
    groups[from + 1]! & 0xff,
  ];
}

export function isPublicIpv6(groups: number[]) {
  const [g0, g1, g2, g3, g4, g5] = groups as [number, number, number, number, number, number];

  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated compatible): judge the IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    if (g5 === 0 && groups[6] === 0 && (groups[7] === 0 || groups[7] === 1)) return false; // :: and ::1
    return isPublicIpv4(embeddedV4(groups, 6));
  }
  // 64:ff9b::/96 NAT64 well-known prefix embeds an IPv4 address.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicIpv4(embeddedV4(groups, 6));
  }
  // 64:ff9b:1::/48 local-use NAT64.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return false;
  // 2002::/16 6to4 embeds an IPv4 address in groups 1-2.
  if (g0 === 0x2002) return isPublicIpv4(embeddedV4(groups, 1));

  // Only global unicast 2000::/3 is allowed, minus reserved blocks inside it.
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && g1 < 0x200) return false; // 2001::/23 IETF protocol (Teredo, ORCHID...)
  if (g0 === 0x2001 && g1 === 0xdb8) return false; // documentation
  if (g0 === 0x3fff && g1 < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

/** True only for a literal, public unicast IP address. */
export function isPublicIp(address: string) {
  const v4 = parseIpv4(address);
  if (v4) return isPublicIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6) return isPublicIpv6(v6);
  return false;
}

function isIpLiteral(hostname: string) {
  return parseIpv4(hostname) !== null || parseIpv6(hostname) !== null;
}

// ---------- URL checks ----------

/** Validates the shape of a URL to fetch. Address checks happen in `assertPublicHost`. */
export function parsePreviewUrl(raw: string, base?: string): URL {
  let url: URL;
  try {
    url = base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    throw new PreviewError('bad_url', 'The link is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PreviewError('bad_url', 'Only http and https links can be previewed.');
  }
  if (url.username || url.password) {
    throw new PreviewError('bad_url', 'Links with credentials are not fetched.');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new PreviewError('bad_url', 'Only standard web ports are fetched.');
  }
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new PreviewError('blocked_address', 'Local addresses are not fetched.');
  }
  url.hash = '';
  return url;
}

export async function assertPublicHost(url: URL, resolve: Resolver) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIpLiteral(hostname)) {
    if (!isPublicIp(hostname)) {
      throw new PreviewError('blocked_address', 'That address is private or reserved.');
    }
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new PreviewError('dns_failed', 'The site name could not be resolved.');
  }
  if (addresses.length === 0) {
    throw new PreviewError('dns_failed', 'The site name could not be resolved.');
  }
  // Every answer must be public: a name that also points inward is refused outright.
  if (!addresses.every(isPublicIp)) {
    throw new PreviewError(
      'blocked_address',
      'That site resolves to a private or reserved address.',
    );
  }
}

// ---------- Fetching ----------

export type SafeFetchOptions = {
  accept: string;
  fetch: Fetcher;
  maxRedirects?: number;
  resolve: Resolver;
  /** Shared deadline; defaults to 5 s from the call. */
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
};

export type SafeResponse = { finalUrl: URL; response: Response; signal: AbortSignal };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Fetches a URL, checking every hop against the SSRF rules above. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = parsePreviewUrl(rawUrl);

  for (let hop = 0; ; hop += 1) {
    await assertPublicHost(url, options.resolve);
    if (signal.aborted) throw new PreviewError('timeout', 'The site took too long to answer.');

    let response: Response;
    try {
      response = await options.fetch(url.href, {
        credentials: 'omit',
        headers: {
          accept: options.accept,
          'accept-language': 'en;q=0.9, *;q=0.5',
          'user-agent':
            options.userAgent ?? 'SecondBrainLinkPreview/1.0 (+https://brain.okdaily.net)',
        },
        method: 'GET',
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new PreviewError('timeout', 'The site took too long to answer.');
      throw new PreviewError('network', error instanceof Error ? error.message : 'Network error.');
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { finalUrl: url, response, signal };
    }
    await response.body?.cancel().catch(() => undefined);
    const location = response.headers.get('location');
    if (!location) throw new PreviewError('http_error', 'The site sent a redirect with no target.');
    if (hop >= maxRedirects) {
      throw new PreviewError('too_many_redirects', 'The link redirects too many times.');
    }
    url = parsePreviewUrl(location, url.href);
  }
}

/** Reads at most `maxBytes`. With `truncate`, a longer body is cut; otherwise it is an error. */
export async function readLimited(
  response: Response,
  maxBytes: number,
  { truncate = false, signal }: { signal?: AbortSignal; truncate?: boolean } = {},
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new PreviewError('too_large', 'The response is too large.');
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new PreviewError('timeout', 'The site took too long to answer.');
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        if (!truncate) throw new PreviewError('too_large', 'The response is too large.');
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    if (error instanceof PreviewError) throw error;
    if (signal?.aborted) throw new PreviewError('timeout', 'The site took too long to answer.');
    throw new PreviewError('network', 'The response could not be read.');
  } finally {
    reader.cancel().catch(() => undefined);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function mediaType(response: Response) {
  return (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
}

export function isHtmlType(type: string) {
  return type === 'text/html' || type === 'application/xhtml+xml';
}
