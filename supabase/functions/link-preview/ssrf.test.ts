// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  isPublicIp,
  parseIpv6,
  parsePreviewUrl,
  PreviewError,
  readLimited,
  safeFetch,
  type Fetcher,
  type Resolver,
} from './ssrf.ts';

const PUBLIC_V4 = '93.184.215.14';

function redirect(location: string, status = 302) {
  return new Response(null, { headers: { location }, status });
}

function html(body = '<title>x</title>') {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof PreviewError ? error.code : String(error);
  }
}

describe('isPublicIp', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks IPv4 %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each([
    '::',
    '::1',
    '[::1]',
    'fe80::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'ff02::1',
    'fec0::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.1.2.3',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1::1',
    '2002:7f00:1::',
    '2002:c0a8:101::1',
    '2001::1',
    '2001:db8::1',
    '3fff::1',
    '100::1',
    'fe80::1%eth0',
  ])('blocks IPv6 %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each([
    PUBLIC_V4,
    '1.1.1.1',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4009:81f::200e',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
  ])('allows public %s', (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it.each(['localhost', 'example.com', '1.2.3', '1.2.3.256', '01.2.3.4x', '1::2::3', ''])(
    'treats %s as not an IP literal',
    (value) => {
      expect(isPublicIp(value)).toBe(false);
    },
  );

  it('parses compressed and embedded IPv6 forms', () => {
    expect(parseIpv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseIpv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('parsePreviewUrl', () => {
  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'gopher://example.com',
    'https://user:pass@example.com/',
    'https://example.com:22/',
    'http://localhost/',
    'http://app.localhost./',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => parsePreviewUrl(url)).toThrow(PreviewError);
  });

  it('accepts http and https on web ports and drops the fragment', () => {
    expect(parsePreviewUrl('https://example.com/a?b=1#c').href).toBe('https://example.com/a?b=1');
    expect(parsePreviewUrl('http://example.com:8080/').port).toBe('8080');
  });

  it('normalises numeric IPv4 hosts so they cannot dodge the check', () => {
    expect(parsePreviewUrl('http://2130706433/').hostname).toBe('127.0.0.1');
    expect(parsePreviewUrl('http://0x7f.1/').hostname).toBe('127.0.0.1');
  });
});

describe('safeFetch', () => {
  const publicResolver: Resolver = vi.fn(async () => [PUBLIC_V4]);

  it('fetches a public page without credentials or cookies', async () => {
    const fetcher = vi.fn<Fetcher>(async () => html());
    const { finalUrl, response } = await safeFetch('https://example.com/post', {
      accept: 'text/html',
      fetch: fetcher,
      resolve: publicResolver,
    });

    expect(response.status).toBe(200);
    expect(finalUrl.href).toBe('https://example.com/post');
    const init = fetcher.mock.calls[0]![1];
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('omit');
    const headers = new Headers(init.headers);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses literal private addresses before any request', async () => {
    const fetcher = vi.fn<Fetcher>(async () => html());
    for (const url of [
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/',
      'http://2130706433/',
    ]) {
      expect(
        await codeOf(safeFetch(url, { accept: '*/*', fetch: fetcher, resolve: publicResolver })),
      ).toBe('blocked_address');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses names that resolve to any private address', async () => {
    const fetcher = vi.fn<Fetcher>(async () => html());
    const resolve: Resolver = async () => [PUBLIC_V4, '10.0.0.5'];
    expect(
      await codeOf(
        safeFetch('https://internal.example/', { accept: '*/*', fetch: fetcher, resolve }),
      ),
    ).toBe('blocked_address');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when DNS fails or returns nothing', async () => {
    const fetcher = vi.fn<Fetcher>(async () => html());
    expect(
      await codeOf(
        safeFetch('https://nx.example/', {
          accept: '*/*',
          fetch: fetcher,
          resolve: async () => {
            throw new Error('NXDOMAIN');
          },
        }),
      ),
    ).toBe('dns_failed');
    expect(
      await codeOf(
        safeFetch('https://empty.example/', {
          accept: '*/*',
          fetch: fetcher,
          resolve: async () => [],
        }),
      ),
    ).toBe('dns_failed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks every redirect hop, including relative and private targets', async () => {
    const resolve: Resolver = async (host) =>
      host === 'evil.example' ? ['192.168.0.10'] : [PUBLIC_V4];
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(redirect('/moved'))
      .mockResolvedValueOnce(redirect('https://evil.example/admin', 301));

    expect(
      await codeOf(safeFetch('https://example.com/', { accept: '*/*', fetch: fetcher, resolve })),
    ).toBe('blocked_address');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/',
      'https://example.com/moved',
    ]);
  });

  it('refuses redirects to other schemes and to literal loopback', async () => {
    for (const location of ['file:///etc/passwd', 'http://127.0.0.1:80/', 'http://[::1]/']) {
      const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(redirect(location));
      const code = await codeOf(
        safeFetch('https://example.com/', {
          accept: '*/*',
          fetch: fetcher,
          resolve: publicResolver,
        }),
      );
      expect(['bad_url', 'blocked_address']).toContain(code);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('follows at most three redirects', async () => {
    const fetcher = vi.fn<Fetcher>(async (url) => redirect(`${url}x`));
    expect(
      await codeOf(
        safeFetch('https://example.com/', {
          accept: '*/*',
          fetch: fetcher,
          resolve: publicResolver,
        }),
      ),
    ).toBe('too_many_redirects');
    expect(fetcher).toHaveBeenCalledTimes(4);

    const ok = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(redirect('/1'))
      .mockResolvedValueOnce(redirect('/2'))
      .mockResolvedValueOnce(redirect('/3'))
      .mockResolvedValueOnce(html());
    const { finalUrl } = await safeFetch('https://example.com/', {
      accept: '*/*',
      fetch: ok,
      resolve: publicResolver,
    });
    expect(finalUrl.pathname).toBe('/3');
  });

  it('times out slow sites', async () => {
    const fetcher: Fetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    expect(
      await codeOf(
        safeFetch('https://slow.example/', {
          accept: '*/*',
          fetch: fetcher,
          resolve: publicResolver,
          timeoutMs: 20,
        }),
      ),
    ).toBe('timeout');
  });
});

describe('readLimited', () => {
  function streamOf(chunks: number[]) {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(65));
          controller.close();
        },
      }),
    );
  }

  it('reads a body under the cap', async () => {
    expect((await readLimited(streamOf([10, 10]), 100)).byteLength).toBe(20);
  });

  it('refuses a body over the cap, even without Content-Length', async () => {
    expect(await codeOf(readLimited(streamOf([60, 60]), 100))).toBe('too_large');
  });

  it('refuses early when Content-Length is over the cap', async () => {
    const response = new Response('x', { headers: { 'content-length': '5000000' } });
    expect(await codeOf(readLimited(response, 1024))).toBe('too_large');
  });

  it('can truncate instead (HTML metadata lives at the top)', async () => {
    const bytes = await readLimited(streamOf([60, 60, 60]), 100, { truncate: true });
    expect(bytes.byteLength).toBe(100);
  });
});
