import { useCallback, useEffect, useRef, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { type CaptureSearchResult, searchCaptures } from './searchCaptures';

export type CaptureSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { mode: 'fulltext' | 'substring'; results: CaptureSearchResult[]; status: 'ready' };

/**
 * Runs a search whenever `query` changes. Only the newest request may update the state, so a
 * slow earlier response can never overwrite the results for what the user typed last.
 */
export function useCaptureSearch(client: SecondBrainClient, query: string, enabled = true) {
  const [state, setState] = useState<CaptureSearchState>({ status: 'idle' });
  const latestRequest = useRef(0);
  const trimmed = query.trim();

  const run = useCallback(async () => {
    const requestId = ++latestRequest.current;

    if (!enabled || !trimmed) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'loading' });

    try {
      const { mode, results } = await searchCaptures(client, trimmed);
      if (requestId === latestRequest.current) {
        setState({ mode, results, status: 'ready' });
      }
    } catch {
      if (requestId === latestRequest.current) {
        setState({ status: 'error' });
      }
    }
  }, [client, enabled, trimmed]);

  useEffect(() => {
    void run();
    return () => {
      // Invalidate the in-flight request when the query changes or the page unmounts.
      latestRequest.current += 1;
    };
  }, [run]);

  return { retry: run, state };
}
