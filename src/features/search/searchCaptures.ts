import type { CaptureStatus } from '../capture/captureLifecycle';
import type { SecondBrainClient } from '../../lib/supabase/client';
import { selectWithPreview } from '../linkPreview/linkPreview';
import { tagsFromEmbed, type EmbeddedCaptureTags } from '../tags/tagNames';

export const SEARCH_RESULT_LIMIT = 50;
const MAX_TERMS = 8;
const MAX_QUERY_LENGTH = 200;

export type CaptureSearchResult = {
  content: string | null;
  created_at: string;
  id: string;
  is_favorite: boolean;
  kind: string;
  /** The name of a file that matched the search (file captures only; null otherwise). */
  file_name?: string | null;
  /** A link's page description from its preview (null when none, or not returned yet). */
  link_description: string | null;
  /** A link's page title from its preview. */
  link_title: string | null;
  source_url: string | null;
  status: CaptureStatus;
  /** Tag names, sorted. */
  tags: string[];
  title: string | null;
};

export type CaptureSearchResponse = {
  /** `fulltext` uses the search_captures database function; `substring` is the fallback. */
  mode: 'fulltext' | 'substring';
  results: CaptureSearchResult[];
};

/** Splits what the user typed into distinct, non-empty terms (max 8, case-insensitive). */
export function parseSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const term of query.slice(0, MAX_QUERY_LENGTH).trim().split(/\s+/u)) {
    const key = term.toLocaleLowerCase();
    if (term && !seen.has(key)) {
      seen.add(key);
      terms.push(term);
    }
    if (terms.length === MAX_TERMS) {
      break;
    }
  }

  return terms;
}

const BASE_SEARCH_COLUMNS = ['title', 'content', 'source_url'] as const;
const PREVIEW_SEARCH_COLUMNS = ['link_title', 'link_description'] as const;

/**
 * Builds one PostgREST `or=(…)` filter that matches a term anywhere in the given columns (by
 * default the title, content and link; the fallback adds the preview columns when they exist). LIKE wildcards in the term are escaped, and the value is double-quoted so commas,
 * dots and parentheses cannot change the filter. (PostgREST still treats `*` as a wildcard.)
 */
export function buildSubstringFilter(
  term: string,
  columns: readonly string[] = BASE_SEARCH_COLUMNS,
): string {
  const likePattern = `%${term.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
  const quoted = `"${likePattern.replace(/[\\"]/gu, (character) => `\\${character}`)}"`;
  return columns.map((column) => `${column}.ilike.${quoted}`).join(',');
}

// Remembered for the session once the database says the function is missing, so a search
// that falls back does not pay for a failed RPC on every keystroke.
let fullTextUnavailable = false;

export function resetSearchCapabilityForTests() {
  fullTextUnavailable = false;
}

function isMissingFunctionError(error: { code?: string; message?: string }) {
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function/iu.test(error.message ?? '')
  );
}

type CaptureSearchRow = {
  capture_tags?: EmbeddedCaptureTags;
  content: string | null;
  created_at: string;
  id: string;
  is_favorite?: boolean | null;
  kind: string;
  link_description?: string | null;
  link_title?: string | null;
  source_url: string | null;
  status: string;
  tags?: string[] | null;
  title: string | null;
};

function toSearchResult(row: CaptureSearchRow): CaptureSearchResult {
  return {
    content: row.content,
    created_at: row.created_at,
    id: row.id,
    // Older deployments of search_captures return neither column; treat that as "none".
    is_favorite: row.is_favorite ?? false,
    kind: row.kind,
    // search_captures before 202610260004 (or a database without previews) has no such columns.
    link_description: row.link_description ?? null,
    link_title: row.link_title ?? null,
    source_url: row.source_url,
    status: row.status as CaptureStatus,
    tags: row.tags ?? tagsFromEmbed(row.capture_tags).map((tag) => tag.name),
    title: row.title,
  };
}

export class CaptureSearchError extends Error {
  constructor(cause: unknown) {
    super('Search failed.', { cause });
    this.name = 'CaptureSearchError';
  }
}

/**
 * File captures whose attachment file names contain every term. This runs next to the text
 * search (the database function only knows titles, notes, links and tags), needs no SQL, and
 * never fails the search: if it cannot run, the text results stand on their own.
 */
async function searchFileNames(client: SecondBrainClient, terms: string[]) {
  try {
    let request = client
      .from('attachments')
      .select('capture_id, original_name')
      .order('created_at', { ascending: false })
      .limit(SEARCH_RESULT_LIMIT);
    for (const term of terms) {
      request = request.ilike('original_name', `%${term.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`);
    }
    const { data: named, error } = await request;
    if (error || !named?.length) {
      return [];
    }

    const nameByCapture = new Map<string, string>();
    for (const row of named) {
      if (!nameByCapture.has(row.capture_id)) {
        nameByCapture.set(row.capture_id, row.original_name);
      }
    }

    const { data: captures, error: captureError } = await client
      .from('captures')
      .select(
        'id, kind, status, title, content, source_url, created_at, is_favorite, capture_tags(tags(id, name))',
      )
      .eq('kind', 'file')
      .in('id', [...nameByCapture.keys()])
      .order('created_at', { ascending: false });
    if (captureError || !captures) {
      return [];
    }

    return (captures as unknown as CaptureSearchRow[]).map((row) => ({
      ...toSearchResult(row),
      file_name: nameByCapture.get(row.id) ?? null,
    }));
  } catch {
    return [];
  }
}

/** Adds file-name matches after the text matches, without repeating a capture. */
function withFileMatches(results: CaptureSearchResult[], files: CaptureSearchResult[]) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const merged = results.map((result) => {
    const fileName = files.find((file) => file.id === result.id)?.file_name;
    return fileName ? { ...result, file_name: fileName } : result;
  });
  for (const file of files) {
    if (!byId.has(file.id)) {
      merged.push(file);
    }
  }
  return merged.slice(0, SEARCH_RESULT_LIMIT);
}

/** Searches every capture the signed-in user owns, whatever its status. */
export async function searchCaptures(
  client: SecondBrainClient,
  query: string,
): Promise<CaptureSearchResponse> {
  const response = await searchText(client, query);
  const terms = parseSearchTerms(query);
  if (terms.length === 0) {
    return response;
  }
  return {
    ...response,
    results: withFileMatches(response.results, await searchFileNames(client, terms)),
  };
}

async function searchText(
  client: SecondBrainClient,
  query: string,
): Promise<CaptureSearchResponse> {
  const terms = parseSearchTerms(query);
  if (terms.length === 0) {
    return { mode: fullTextUnavailable ? 'substring' : 'fulltext', results: [] };
  }

  if (!fullTextUnavailable) {
    const { data, error } = await client.rpc('search_captures', {
      p_limit: SEARCH_RESULT_LIMIT,
      p_query: terms.join(' '),
    });

    if (!error) {
      return {
        mode: 'fulltext',
        results: (data ?? []).map(toSearchResult),
      };
    }

    if (!isMissingFunctionError(error)) {
      throw new CaptureSearchError(error);
    }

    fullTextUnavailable = true;
  }

  // With the preview columns (if the database has them) a term may also match a page title or
  // description; without them this quietly retries on the original columns.
  const { data, error } = await selectWithPreview((previewColumns) => {
    const columns = previewColumns
      ? [...BASE_SEARCH_COLUMNS, ...PREVIEW_SEARCH_COLUMNS]
      : BASE_SEARCH_COLUMNS;
    let request = client
      .from('captures')
      .select(
        `id, kind, status, title, content, source_url, created_at, is_favorite, capture_tags(tags(id, name))${previewColumns}`,
      );

    // Chained .or() filters are ANDed, so every term has to appear somewhere in the capture.
    for (const term of terms) {
      request = request.or(buildSubstringFilter(term, columns));
    }

    return request.order('created_at', { ascending: false }).limit(SEARCH_RESULT_LIMIT);
  });

  if (error) {
    throw new CaptureSearchError(error);
  }

  return {
    mode: 'substring',
    results: ((data ?? []) as unknown as CaptureSearchRow[]).map(toSearchResult),
  };
}
