import { useCallback, useEffect, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { loadTags } from './tagsApi';
import { sortTags, tagKey, type Tag } from './tagNames';

/** The user's existing tags for autocomplete. Failing to load only disables suggestions. */
export function useTagLibrary(client: SecondBrainClient, enabled: boolean) {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let isActive = true;
    loadTags(client)
      .then((loaded) => {
        if (isActive) {
          setTags(loaded);
        }
      })
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [client, enabled]);

  const remember = useCallback((added: readonly Tag[]) => {
    setTags((current) => {
      const keys = new Set(current.map((tag) => tagKey(tag.name)));
      const fresh = added.filter((tag) => !keys.has(tagKey(tag.name)));
      return fresh.length ? sortTags([...current, ...fresh]) : current;
    });
  }, []);

  return { remember, tags };
}
