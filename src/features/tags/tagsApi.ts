import type { SecondBrainClient } from '../../lib/supabase/client';
import { sortTags, tagKey, type Tag } from './tagNames';

const UNIQUE_VIOLATION = '23505';

export class TagError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'TagError';
  }
}

/** Every tag the signed-in user has, for autocomplete. RLS limits rows to the owner. */
export async function loadTags(client: SecondBrainClient): Promise<Tag[]> {
  const { data, error } = await client.from('tags').select('id, name').order('name');
  if (error) {
    throw new TagError('Tags could not be loaded.', error);
  }
  return sortTags(data ?? []);
}

/** Returns the user's tag with this name, creating it when it does not exist yet. */
export async function ensureTag(
  client: SecondBrainClient,
  userId: string,
  name: string,
  library: readonly Tag[],
): Promise<Tag> {
  const existing = library.find((tag) => tagKey(tag.name) === tagKey(name));
  if (existing) {
    return existing;
  }

  const { data, error } = await client
    .from('tags')
    .insert({ name, user_id: userId })
    .select('id, name')
    .single();

  if (!error && data) {
    return data;
  }

  // Created meanwhile (another device or tab): use the stored one.
  if (error?.code === UNIQUE_VIOLATION) {
    const { data: stored, error: lookupError } = await client
      .from('tags')
      .select('id, name')
      .eq('normalized_name', tagKey(name))
      .single();
    if (!lookupError && stored) {
      return stored;
    }
  }

  throw new TagError('The tag could not be created.', error);
}

export async function attachTag(
  client: SecondBrainClient,
  userId: string,
  captureId: string,
  tagId: string,
) {
  const { error } = await client
    .from('capture_tags')
    .insert({ capture_id: captureId, tag_id: tagId, user_id: userId });

  // Already attached is fine: the result is the same.
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new TagError('The tag could not be added.', error);
  }
}

export async function detachTag(client: SecondBrainClient, captureId: string, tagId: string) {
  const { error } = await client
    .from('capture_tags')
    .delete()
    .eq('capture_id', captureId)
    .eq('tag_id', tagId);
  if (error) {
    throw new TagError('The tag could not be removed.', error);
  }
}

/** Creates any missing tags and attaches them all to a capture. Returns the stored tags. */
export async function applyTags(
  client: SecondBrainClient,
  userId: string,
  captureId: string,
  names: readonly string[],
  library: readonly Tag[],
): Promise<Tag[]> {
  const known = [...library];
  const applied: Tag[] = [];
  for (const name of names) {
    const tag = await ensureTag(client, userId, name, known);
    known.push(tag);
    await attachTag(client, userId, captureId, tag.id);
    applied.push(tag);
  }
  return applied;
}

export async function setFavorite(client: SecondBrainClient, captureId: string, value: boolean) {
  const { error } = await client
    .from('captures')
    .update({ is_favorite: value })
    .eq('id', captureId);
  if (error) {
    throw new TagError('The favorite could not be saved.', error);
  }
}
