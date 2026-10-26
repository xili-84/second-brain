import { useCallback, useEffect, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import type { CaptureStatus } from '../capture/captureLifecycle';
import {
  selectWithPreview,
  subscribeToLinkPreviews,
  type LinkPreviewFields,
} from '../linkPreview/linkPreview';
import type { EmbeddedCaptureTags } from '../tags/tagNames';

export type CaptureSummary = LinkPreviewFields & {
  attachments?: { storage_path: string }[];
  capture_tags?: EmbeddedCaptureTags;
  content: string | null;
  created_at: string;
  id: string;
  is_favorite?: boolean;
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

    const { data, error } = await selectWithPreview((previewColumns) =>
      client
        .from('captures')
        .select(
          `id, kind, title, content, source_url, created_at, is_favorite, attachments(storage_path), capture_tags(tags(id, name))${previewColumns}`,
        )
        .eq('status', status)
        .order('created_at', { ascending: false }),
    );

    setState((current) =>
      error
        ? { ...current, error: true, isLoading: false }
        : {
            captures: (data ?? []) as unknown as CaptureSummary[],
            error: false,
            isLoading: false,
          },
    );
  }, [client, status, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Local, optimistic change to one row (for example a favorite toggle). */
  const patch = useCallback((id: string, update: Partial<CaptureSummary>) => {
    setState((current) => ({
      ...current,
      captures: current.captures.map((capture) =>
        capture.id === id ? { ...capture, ...update } : capture,
      ),
    }));
  }, []);

  /** Drops rows from the list locally, e.g. after they were deleted. */
  const remove = useCallback((ids: readonly string[]) => {
    const gone = new Set(ids);
    setState((current) => ({
      ...current,
      captures: current.captures.filter((capture) => !gone.has(capture.id)),
    }));
  }, []);

  // A preview fetched after saving (or from the detail page) shows up without a reload.
  useEffect(
    () => subscribeToLinkPreviews(({ captureId, preview }) => patch(captureId, preview)),
    [patch],
  );

  return { ...state, patch, reload, remove };
}
