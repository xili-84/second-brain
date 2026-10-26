import { useEffect, useMemo, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { IMAGE_BUCKET } from '../capture/imageCapture';
import { SIGNED_URL_TTL_SECONDS } from '../capture/imageStorage';
import type { CaptureSummary } from './useCaptureList';

/** The storage path of each image capture's first attachment, in list order. */
export function thumbnailPaths(captures: CaptureSummary[]) {
  return captures.flatMap((capture) => {
    const path = capture.kind === 'image' ? capture.attachments?.[0]?.storage_path : undefined;
    return path ? [path] : [];
  });
}

/**
 * Signs thumbnail URLs for the list on screen with one batched createSignedUrls request.
 * Nothing is requested while `enabled` is false (for example while search results are shown).
 * Failures are silent: rows simply keep their empty image slot.
 */
export function useThumbnails(
  client: SecondBrainClient,
  captures: CaptureSummary[],
  enabled: boolean,
) {
  const paths = useMemo(() => thumbnailPaths(captures), [captures]);
  const key = paths.join('\n');
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled || key === '') {
      return;
    }

    let isActive = true;
    const batch = key.split('\n');

    void (async () => {
      try {
        const { data, error } = await client.storage
          .from(IMAGE_BUCKET)
          .createSignedUrls(batch, SIGNED_URL_TTL_SECONDS);

        if (!isActive || error || !data) {
          return;
        }

        const signed: Record<string, string> = {};
        for (const entry of data) {
          if (entry.path && entry.signedUrl && !entry.error) {
            signed[entry.path] = entry.signedUrl;
          }
        }
        setUrls(signed);
      } catch {
        // Thumbnails are decoration; the list works without them.
      }
    })();

    return () => {
      isActive = false;
    };
  }, [client, enabled, key]);

  return urls;
}
