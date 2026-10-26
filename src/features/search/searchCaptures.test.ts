import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import {
  buildSubstringFilter,
  CaptureSearchError,
  parseSearchTerms,
  resetSearchCapabilityForTests,
  searchCaptures,
} from './searchCaptures';

const row = {
  content: 'Paid the invoice',
  created_at: '2026-10-26T10:00:00.000Z',
  id: 'capture-1',
  kind: 'note',
  source_url: null,
  status: 'archived',
  title: 'Invoice',
};

function createClient({
  rpcResult,
  tableResult = { data: [row], error: null },
}: {
  rpcResult: { data: unknown; error: unknown };
  tableResult?: { data: unknown; error: unknown };
}) {
  const builder = {
    limit: vi.fn().mockResolvedValue(tableResult),
    or: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  const client = {
    from: vi.fn().mockReturnValue(builder),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  return { builder, client, typed: client as unknown as SecondBrainClient };
}

beforeEach(() => {
  resetSearchCapabilityForTests();
});

describe('parseSearchTerms', () => {
  it('splits on whitespace, drops duplicates case-insensitively and caps at eight terms', () => {
    expect(parseSearchTerms('  Rec  rec\tinv\n ')).toEqual(['Rec', 'inv']);
    expect(parseSearchTerms('a b c d e f g h i j')).toHaveLength(8);
    expect(parseSearchTerms('   ')).toEqual([]);
  });
});

describe('buildSubstringFilter', () => {
  it('escapes LIKE wildcards and quotes the value for PostgREST', () => {
    expect(buildSubstringFilter('50%_off,(now)"x"\\')).toBe(
      [
        'title.ilike."%50\\\\%\\\\_off,(now)\\"x\\"\\\\\\\\%"',
        'content.ilike."%50\\\\%\\\\_off,(now)\\"x\\"\\\\\\\\%"',
        'source_url.ilike."%50\\\\%\\\\_off,(now)\\"x\\"\\\\\\\\%"',
      ].join(','),
    );
  });
});

describe('searchCaptures', () => {
  it('uses the full-text database function and drops the rank column', async () => {
    const { client, typed } = createClient({
      rpcResult: { data: [{ ...row, rank: 0.4 }], error: null },
    });

    await expect(searchCaptures(typed, '  invoice  paid ')).resolves.toEqual({
      mode: 'fulltext',
      results: [row],
    });
    expect(client.rpc).toHaveBeenCalledWith('search_captures', {
      p_limit: 50,
      p_query: 'invoice paid',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('does not query anything for a blank search', async () => {
    const { client, typed } = createClient({ rpcResult: { data: [], error: null } });

    await expect(searchCaptures(typed, '   ')).resolves.toEqual({ mode: 'fulltext', results: [] });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('falls back to an all-terms substring search when the function is not installed', async () => {
    const { builder, client, typed } = createClient({
      rpcResult: {
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      },
    });

    await expect(searchCaptures(typed, 'invoice paid')).resolves.toEqual({
      mode: 'substring',
      results: [row],
    });
    expect(client.from).toHaveBeenCalledWith('captures');
    expect(builder.or).toHaveBeenNthCalledWith(1, buildSubstringFilter('invoice'));
    expect(builder.or).toHaveBeenNthCalledWith(2, buildSubstringFilter('paid'));
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(50);

    // The missing function is remembered, so the next search skips the RPC.
    await searchCaptures(typed, 'again');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('reports other database errors instead of silently falling back', async () => {
    const { client, typed } = createClient({
      rpcResult: { data: null, error: { code: '57014', message: 'canceling statement' } },
    });

    await expect(searchCaptures(typed, 'invoice')).rejects.toBeInstanceOf(CaptureSearchError);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('reports fallback errors', async () => {
    const { typed } = createClient({
      rpcResult: { data: null, error: { code: '42883', message: 'function does not exist' } },
      tableResult: { data: null, error: { message: 'offline' } },
    });

    await expect(searchCaptures(typed, 'invoice')).rejects.toBeInstanceOf(CaptureSearchError);
  });
});
