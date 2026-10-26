import { useEffect, useMemo, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { IMAGE_BUCKET } from '../capture/imageCapture';
import { SIGNED_URL_TTL_SECONDS } from '../capture/imageStorage';
import { LINK_PREVIEW_BUCKET } from '../linkPreview/linkPreview';
import type { CaptureSummary } from './useCaptureList';

type ThumbnailSource = { bucket: string; path: string };

/** Where a row's thumbnail comes from: an image capture's first attachment or a link preview. */
export function thumbnailSource(capture: CaptureSummary): ThumbnailSource | null {
  if (capture.kind === 'image') {
    const path = capture.attachments?.[0]?.storage_path;
    return path ? { bucket: IMAGE_BUCKET, path } : null;
  }
  if (capture.kind === 'link' && capture.link_image_path) {
    return { bucket: LINK_PREVIEW_BUCKET, path: capture.link_image_path };
  }
  return null;
}

/** Key of a thumbnail in the map returned by useThumbnails. */
export function thumbnailKey(source: ThumbnailSource) {
  return `${source.bucket}/${source.path}`;
}

/** The storage path of each image capture's first attachment, in list order. */
export function thumbnailPaths(captures: CaptureSummary[]) {
  return captures.flatMap((capture) => {
    const source = thumbnailSource(capture);
    return source?.bucket === IMAGE_BUCKET ? [source.path] : [];
  });
}

/** The preview image path of each link capture that has one, in list order. */
export function linkPreviewPaths(captures: CaptureSummary[]) {
  return captures.flatMap((capture) => {
    const source = thumbnailSource(capture);
    return source?.bucket === LINK_PREVIEW_BUCKET ? [source.path] : [];
  });
}

async function signBatch(client: SecondBrainClient, bucket: string, paths: string[]) {
  const signed: Record<string, string> = {};
  if (paths.length === 0) {
    return signed;
  }
  try {
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      return signed;
    }
    for (const entry of data) {
      if (entry.path && entry.signedUrl && !entry.error) {
        signed[thumbnailKey({ bucket, path: entry.path })] = entry.signedUrl;
      }
    }
  } catch {
    // Thumbnails are decoration; the list works without them.
  }
  return signed;
}

/**
 * Signs thumbnail URLs for the list on screen with one batched createSignedUrls request per
 * bucket (image captures and link previews). Nothing is requested while `enabled` is false (for
 * example while search results are shown). Failures are silent: rows keep an empty image slot.
 * Keys come from thumbnailKey().
 */
export function useThumbnails(
  client: SecondBrainClient,
  captures: CaptureSummary[],
  enabled: boolean,
) {
  const imageKey = useMemo(() => thumbnailPaths(captures).join('\n'), [captures]);
  const linkKey = useMemo(() => linkPreviewPaths(captures).join('\n'), [captures]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled || (imageKey === '' && linkKey === '')) {
      return;
    }

    let isActive = true;
    const split = (key: string) => (key === '' ? [] : key.split('\n'));

    void (async () => {
      const [images, links] = await Promise.all([
        signBatch(client, IMAGE_BUCKET, split(imageKey)),
        signBatch(client, LINK_PREVIEW_BUCKET, split(linkKey)),
      ]);
      if (isActive) {
        setUrls({ ...images, ...links });
      }
    })();

    return () => {
      isActive = false;
    };
  }, [client, enabled, imageKey, linkKey]);

  return urls;
}
