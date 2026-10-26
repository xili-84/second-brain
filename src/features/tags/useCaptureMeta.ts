import { useCallback, useEffect, useRef, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { attachTag, detachTag, ensureTag, setFavorite } from './tagsApi';
import { sortTags, tagKey, tagsFromEmbed, type EmbeddedCaptureTags, type Tag } from './tagNames';
import { useTagLibrary } from './useTagLibrary';

type CaptureWithMeta = {
  capture_tags?: EmbeddedCaptureTags;
  id: string;
  is_favorite?: boolean;
};

const PENDING = 'pending:';

/**
 * Favorite flag and tags of one opened capture. Changes apply immediately (optimistically) and
 * roll back with an error message if the database refuses them. They never touch the capture's
 * text, attachments or status, so edit and delete safety rules are unaffected.
 */
export function useCaptureMeta(
  client: SecondBrainClient,
  userId: string | undefined,
  capture: CaptureWithMeta | null,
) {
  const library = useTagLibrary(client, Boolean(userId));
  const [isFavorite, setIsFavorite] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tagsRef = useRef<Tag[]>([]);

  // Start from the record when a capture opens. Later saves of the text return the capture
  // without its tags, so they must not reset what is shown here.
  const latest = useRef(capture);
  latest.current = capture;
  const captureId = capture?.id;
  useEffect(() => {
    const record = latest.current;
    const next = tagsFromEmbed(record?.capture_tags);
    tagsRef.current = next;
    setTags(next);
    setIsFavorite(Boolean(record?.is_favorite));
    setError(null);
  }, [captureId]);

  const update = useCallback((change: (current: Tag[]) => Tag[]) => {
    tagsRef.current = change(tagsRef.current);
    setTags(tagsRef.current);
  }, []);

  const toggleFavorite = useCallback(async () => {
    if (!capture) {
      return;
    }
    const next = !isFavorite;
    setError(null);
    setIsFavorite(next);
    try {
      await setFavorite(client, capture.id, next);
    } catch {
      setIsFavorite(!next);
      setError('The favorite could not be saved. Check your connection and try again.');
    }
  }, [capture, client, isFavorite]);

  const addTag = useCallback(
    async (name: string) => {
      if (!capture || !userId || tagsRef.current.some((tag) => tagKey(tag.name) === tagKey(name))) {
        return;
      }
      setError(null);
      const placeholder = { id: `${PENDING}${tagKey(name)}`, name };
      update((current) => sortTags([...current, placeholder]));
      try {
        const tag = await ensureTag(client, userId, name, library.tags);
        await attachTag(client, userId, capture.id, tag.id);
        library.remember([tag]);
        update((current) => sortTags(current.map((item) => (item === placeholder ? tag : item))));
      } catch {
        update((current) => current.filter((item) => item !== placeholder));
        setError(`The tag “${name}” could not be added. Check your connection and try again.`);
      }
    },
    [capture, client, library, update, userId],
  );

  const removeTag = useCallback(
    async (name: string) => {
      const tag = tagsRef.current.find((item) => tagKey(item.name) === tagKey(name));
      // A tag that is still being added has no stored link to remove yet.
      if (!capture || !tag || tag.id.startsWith(PENDING)) {
        return;
      }
      setError(null);
      update((current) => current.filter((item) => item !== tag));
      try {
        await detachTag(client, capture.id, tag.id);
      } catch {
        update((current) => sortTags([...current, tag]));
        setError(
          `The tag “${tag.name}” could not be removed. Check your connection and try again.`,
        );
      }
    },
    [capture, client, update],
  );

  return { addTag, error, isFavorite, library: library.tags, removeTag, tags, toggleFavorite };
}
