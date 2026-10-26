import { useCallback, useEffect, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import type { CaptureStatus } from '../capture/captureLifecycle';

export type CaptureSummary = {
  attachments?: { storage_path: string }[];
  content: string | null;
  created_at: string;
  id: string;
  kind: string;
  source_url: string | null;
  title: string | null;
};

type ListState = {
  captures: CaptureSummary[];
  error: boolean;
  isLoading: boolean;
};

/** Loads one status list, newest first. */
export function useCaptureList(
  client: SecondBrainClient,
  status: CaptureStatus,
  userId: string | undefined,
) {
  const [state, setState] = useState<ListState>({ captures: [], error: false, isLoading: true });

  const reload = useCallback(async () => {
    if (!userId) {
      return;
    }

    setState((current) => ({ ...current, error: false, isLoading: true }));

    const { data, error } = await client
      .from('captures')
      .select('id, kind, title, content, source_url, created_at, attachments(storage_path)')
      .eq('status', status)
      .order('created_at', { ascending: false });

    setState((current) =>
      error
        ? { ...current, error: true, isLoading: false }
        : { captures: (data ?? []) as CaptureSummary[], error: false, isLoading: false },
    );
  }, [client, status, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
