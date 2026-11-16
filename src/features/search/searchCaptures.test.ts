import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { resetLinkPreviewSupport } from '../linkPreview/linkPreview';
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

// Rows from an older search_captures (or the fallback without embeds) have no tags/favorite
// and no preview columns.
const result = { ...row, is_favorite: false, link_description: null, link_title: null, tags: [] };
const noPreview = { link_description: null, link_title: null };

function createClient({
  rpcResult,
  tableResult = { data: [row], error: null },
  tableResults,
}: {
  rpcResult: { data: unknown; error: unknown };
  tableResult?: { data: unknown; error: unknown };
  /** One result per fallback query, in order (for the retry without preview columns). */
  tableResults?: { data: unknown; error: unknown }[];
}) {
  const limit = vi.fn();
  for (const next of tableResults ?? []) {
    limit.mockResolvedValueOnce(next);
  }
  limit.mockResolvedValue(tableResult);
  const builder = {
    limit,
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
  resetLinkPreviewSupport();
});

const PREVIEW_SELECT =
  ', link_title, link_description, link_site_name, link_image_path, link_favicon, link_preview_status';
const ALL_COLUMNS = ['title', 'content', 'source_url', 'link_title', 'link_description'];

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
      results: [result],
    });
    expect(client.rpc).toHaveBeenCalledWith('search_captures', {
      p_limit: 50,
      p_query: 'invoice paid',
    });
    // Only the file-name lookup may touch a table; the text search itself ran in the function.
    expect(client.from).not.toHaveBeenCalledWith('captures');
  });

  it('passes through tags and the favorite flag from the database function', async () => {
    const { typed } = createClient({
      rpcResult: {
        data: [{ ...row, is_favorite: true, rank: 0.2, tags: ['Finance', 'March'] }],
        error: null,
      },
    });

    await expect(searchCaptures(typed, 'march')).resolves.toEqual({
      mode: 'fulltext',
      results: [{ ...row, ...noPreview, is_favorite: true, tags: ['Finance', 'March'] }],
    });
  });

  it('reads tags from the embedded join in the fallback search', async () => {
    const { typed } = createClient({
      rpcResult: {
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      },
      tableResult: {
        data: [
          {
            ...row,
            capture_tags: [
              { tags: { id: 't2', name: 'march' } },
              { tags: { id: 't1', name: 'Bills' } },
            ],
            is_favorite: true,
          },
        ],
        error: null,
      },
    });

    const response = await searchCaptures(typed, 'invoice');
    expect(response.results[0]).toEqual({
      ...row,
      ...noPreview,
      is_favorite: true,
      tags: ['Bills', 'march'],
    });
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
      results: [result],
    });
    expect(client.from).toHaveBeenCalledWith('captures');
    expect(builder.select).toHaveBeenCalledWith(
      `id, kind, status, title, content, source_url, created_at, is_favorite, capture_tags(tags(id, name))${PREVIEW_SELECT}`,
    );
    expect(builder.or).toHaveBeenNthCalledWith(1, buildSubstringFilter('invoice', ALL_COLUMNS));
    expect(builder.or).toHaveBeenNthCalledWith(2, buildSubstringFilter('paid', ALL_COLUMNS));
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(50);

    // The missing function is remembered, so the next search skips the RPC.
    await searchCaptures(typed, 'again');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('returns link preview titles and descriptions from the database function', async () => {
    const { typed } = createClient({
      rpcResult: {
        data: [
          {
            ...row,
            is_favorite: false,
            kind: 'link',
            link_description: 'A guide to invoices',
            link_title: 'Invoice handbook',
            rank: 0.3,
            tags: [],
          },
        ],
        error: null,
      },
    });

    const { results } = await searchCaptures(typed, 'handbook');
    expect(results[0]).toMatchObject({
      link_description: 'A guide to invoices',
      link_title: 'Invoice handbook',
    });
  });

  it('retries the fallback without preview columns when the database lacks them', async () => {
    const { builder, typed } = createClient({
      rpcResult: {
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      },
      tableResults: [
        {
          data: null,
          error: { code: '42703', message: 'column captures.link_title does not exist' },
        },
      ],
    });

    await expect(searchCaptures(typed, 'invoice')).resolves.toEqual({
      mode: 'substring',
      results: [result],
    });
    expect(builder.or).toHaveBeenNthCalledWith(1, buildSubstringFilter('invoice', ALL_COLUMNS));
    expect(builder.or).toHaveBeenNthCalledWith(2, buildSubstringFilter('invoice'));
    expect(builder.select).toHaveBeenNthCalledWith(
      2,
      'id, kind, status, title, content, source_url, created_at, is_favorite, capture_tags(tags(id, name))',
    );
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

  describe('file names', () => {
    function fileClient({
      attachments = [{ capture_id: 'file-1', original_name: 'Quarterly-report.PDF' }],
      captures = [
        {
          content: null,
          created_at: '2026-10-27T10:00:00.000Z',
          id: 'file-1',
          is_favorite: false,
          kind: 'file',
          source_url: null,
          status: 'inbox',
          title: null,
        },
      ],
      rpcRows = [] as unknown[],
    } = {}) {
      const ilike = vi.fn();
      const attachmentsBuilder = {
        ilike,
        limit: vi.fn(),
        order: vi.fn(),
        select: vi.fn(),
      };
      attachmentsBuilder.select.mockReturnValue(attachmentsBuilder);
      attachmentsBuilder.order.mockReturnValue(attachmentsBuilder);
      attachmentsBuilder.limit.mockReturnValue(attachmentsBuilder);
      ilike.mockReturnValue(attachmentsBuilder);
      // The builder is awaited, so it needs a then().
      Object.assign(attachmentsBuilder, {
        then: (resolve: (value: unknown) => void) => resolve({ data: attachments, error: null }),
      });
      const capturesBuilder = {
        eq: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        select: vi.fn(),
      };
      capturesBuilder.select.mockReturnValue(capturesBuilder);
      capturesBuilder.eq.mockReturnValue(capturesBuilder);
      capturesBuilder.in.mockReturnValue(capturesBuilder);
      capturesBuilder.order.mockResolvedValue({ data: captures, error: null });
      const client = {
        from: vi.fn((table: string) =>
          table === 'attachments' ? attachmentsBuilder : capturesBuilder,
        ),
        rpc: vi.fn().mockResolvedValue({ data: rpcRows, error: null }),
      };
      return { attachmentsBuilder, capturesBuilder, typed: client as unknown as SecondBrainClient };
    }

    it('adds file captures whose file name contains every term', async () => {
      const { attachmentsBuilder, capturesBuilder, typed } = fileClient();

      const { results } = await searchCaptures(typed, 'quarterly report');

      expect(attachmentsBuilder.ilike).toHaveBeenNthCalledWith(1, 'original_name', '%quarterly%');
      expect(attachmentsBuilder.ilike).toHaveBeenNthCalledWith(2, 'original_name', '%report%');
      expect(capturesBuilder.eq).toHaveBeenCalledWith('kind', 'file');
      expect(capturesBuilder.in).toHaveBeenCalledWith('id', ['file-1']);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        file_name: 'Quarterly-report.PDF',
        id: 'file-1',
        kind: 'file',
      });
    });

    it('does not repeat a capture the text search already found', async () => {
      const { typed } = fileClient({
        rpcRows: [
          {
            ...row,
            id: 'file-1',
            is_favorite: false,
            kind: 'file',
            rank: 0.2,
            tags: [],
          },
        ],
      });

      const { results } = await searchCaptures(typed, 'report');

      expect(results.map((item) => item.id)).toEqual(['file-1']);
      expect(results[0]?.file_name).toBe('Quarterly-report.PDF');
    });

    it('escapes LIKE wildcards typed by the user', async () => {
      const { attachmentsBuilder, typed } = fileClient({ attachments: [] });

      await searchCaptures(typed, '100%_done');

      expect(attachmentsBuilder.ilike).toHaveBeenCalledWith('original_name', '%100\\%\\_done%');
    });

    it('keeps the text results when the file-name lookup fails', async () => {
      const { typed } = createClient({
        rpcResult: { data: [{ ...row, is_favorite: false, rank: 1, tags: [] }], error: null },
      });

      const { results } = await searchCaptures(typed, 'invoice');

      expect(results).toHaveLength(1);
    });
  });
});
