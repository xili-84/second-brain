/** Tag name rules shared by the composer, the detail page and filters. */

export const MAX_TAG_LENGTH = 50;
export const MAX_TAGS_PER_CAPTURE = 20;

export type Tag = { id: string; name: string };

/**
 * Cleans what the user typed: drops a leading "#", trims, collapses inner whitespace and caps the
 * length at 50 (the database limit). Returns null when nothing is left.
 */
export function normalizeTagName(raw: string): string | null {
  const name = raw.replace(/^#+/u, '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
  return name || null;
}

/** Case-insensitive identity, matching tags.normalized_name (lower(btrim(name))). */
export function tagKey(name: string) {
  return name.trim().toLowerCase();
}

export function sortTags<T extends { name: string }>(tags: readonly T[]): T[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Tags embedded through capture_tags, as returned by `capture_tags(tags(id, name))`. */
export type EmbeddedCaptureTags = { tags: Tag | Tag[] | null }[] | null | undefined;

export function tagsFromEmbed(embed: EmbeddedCaptureTags): Tag[] {
  const tags: Tag[] = [];
  for (const row of embed ?? []) {
    const value = row.tags;
    for (const tag of Array.isArray(value) ? value : value ? [value] : []) {
      tags.push(tag);
    }
  }
  return sortTags(tags);
}

/** Existing tags that start with (then contain) the typed text, minus the ones already applied. */
export function suggestTags(
  library: readonly Tag[],
  applied: readonly { name: string }[],
  typed: string,
  limit = 6,
) {
  const appliedKeys = new Set(applied.map((tag) => tagKey(tag.name)));
  const query = tagKey(typed.replace(/^#+/u, ''));
  const available = library.filter((tag) => !appliedKeys.has(tagKey(tag.name)));
  if (!query) {
    return sortTags(available).slice(0, limit);
  }
  const starts = available.filter((tag) => tagKey(tag.name).startsWith(query));
  const contains = available.filter(
    (tag) => !tagKey(tag.name).startsWith(query) && tagKey(tag.name).includes(query),
  );
  return [...sortTags(starts), ...sortTags(contains)].slice(0, limit);
}
