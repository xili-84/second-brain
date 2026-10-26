import { useCallback, useEffect, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { SIGNED_URL_TTL_SECONDS } from '../capture/imageStorage';
import {
  hasLinkPreview,
  LINK_PREVIEW_BUCKET,
  pickPreview,
  requestLinkPreview,
  subscribeToLinkPreviews,
  type LinkPreviewFields,
} from './linkPreview';

type PreviewCapture = LinkPreviewFields & { id: string; kind: string };
export type RefreshState = 'idle' | 'loading' | 'failed' | 'unavailable';

/**
 * The preview of one opened link capture: its fields, a signed image URL and a refresh action.
 * Like useCaptureMeta it keys on the capture id, because saving an edit returns the record
 * without preview columns and must not blank the card.
 */
export function useLinkPreview(client: SecondBrainClient, capture: PreviewCapture | null) {
  const isLink = capture?.kind === 'link';
  const [fields, setFields] = useState<LinkPreviewFields>(() => pickPreview(capture));
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [shownId, setShownId] = useState(capture?.id);
  if (capture?.id !== shownId) {
    setShownId(capture?.id);
    setFields(pickPreview(capture));
    setRefreshState('idle');
  }

  const captureId = capture?.id;
  const imagePath = isLink ? fields.link_image_path : null;

  useEffect(() => {
    if (!imagePath) return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await client.storage
          .from(LINK_PREVIEW_BUCKET)
          .createSignedUrl(imagePath, SIGNED_URL_TTL_SECONDS);
        if (active) setSigned({ path: imagePath, url: error ? null : (data?.signedUrl ?? null) });
      } catch {
        if (active) setSigned({ path: imagePath, url: null });
      }
    })();
    return () => {
      active = false;
    };
    // A refresh overwrites the same object, so `version` re-signs it to bypass the cached image.
  }, [client, imagePath, version]);

  useEffect(() => {
    if (!captureId) return;
    return subscribeToLinkPreviews((detail) => {
      if (detail.captureId === captureId) setFields(detail.preview);
    });
  }, [captureId]);

  const refresh = useCallback(async () => {
    if (!captureId || !isLink) return;
    setRefreshState('loading');
    const result = await requestLinkPreview(client, captureId);
    if (result.ok) {
      setFields(result.preview);
      setVersion((current) => current + 1);
      setRefreshState('idle');
    } else {
      setRefreshState(result.reason);
    }
  }, [captureId, client, isLink]);

  /** The browser could not load the signed image: drop it and show the card without it. */
  const dropImage = useCallback(() => {
    if (imagePath) setSigned({ path: imagePath, url: null });
  }, [imagePath]);

  return {
    dropImage,
    fields,
    hasPreview: isLink && hasLinkPreview(fields),
    imageUrl: imagePath && signed?.path === imagePath ? signed.url : null,
    refresh,
    refreshState,
  };
}
