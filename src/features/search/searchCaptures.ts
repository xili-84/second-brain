import type { CaptureStatus } from '../capture/captureLifecycle';
import type { SecondBrainClient } from '../../lib/supabase/client';
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

/**
 * Builds one PostgREST `or=(…)` filter that matches a term anywhere in the title, content or
 * link. LIKE wildcards in the term are escaped, and the value is double-quoted so commas,
 * dots and parentheses cannot change the filter. (PostgREST still treats `*` as a wildcard.)
 */
export function buildSubstringFilter(term: string): string {
  const likePattern = `%${term.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
  const quoted = `"${likePattern.replace(/[\\"]/gu, (character) => `\\${character}`)}"`;
  return ['title', 'content', 'source_url'].map((column) => `${column}.ilike.${quoted}`).join(',');
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

/** Searches every capture the signed-in user owns, whatever its status. */
export async function searchCaptures(
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

  let request = client
    .from('captures')
    .select(
      'id, kind, status, title, content, source_url, created_at, is_favorite, capture_tags(tags(id, name))',
    );

  // Chained .or() filters are ANDed, so every term has to appear somewhere in the capture.
  for (const term of terms) {
    request = request.or(buildSubstringFilter(term));
  }

  const { data, error } = await request
    .order('created_at', { ascending: false })
    .limit(SEARCH_RESULT_LIMIT);

  if (error) {
    throw new CaptureSearchError(error);
  }

  return {
    mode: 'substring',
    results: (data ?? []).map(toSearchResult),
  };
}
