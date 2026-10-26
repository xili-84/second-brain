/** Formatting helpers shared by the capture list and search results. */

type Titled = {
  kind: string;
  link_title?: string | null;
  source_url: string | null;
  title: string | null;
};

/**
 * Full title used for headlines and accessible names: the title, else a link's page title from
 * its preview, else the link URL, else "Untitled kind".
 */
export function captureTitle(capture: Titled) {
  return (
    capture.title?.trim() ||
    (capture.kind === 'link' ? capture.link_title?.trim() : '') ||
    (capture.kind === 'link' && capture.source_url
      ? capture.source_url
      : `Untitled ${capture.kind}`)
  );
}

/** True when a link has no title (nor a page title), so the URL stands in as its headline. */
export function isUntitledLink(capture: Titled) {
  return (
    !capture.title?.trim() &&
    !capture.link_title?.trim() &&
    capture.kind === 'link' &&
    Boolean(capture.source_url)
  );
}

/** A URL without its scheme and leading "www.", for display only. */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/iu, '');
}

export function domainOf(url: string | null) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./iu, '') || null;
  } catch {
    return null;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now", "24 min ago", "5 h ago", then a short date ("26 Oct, 10:58"). */
export function relativeTime(iso: string, now = Date.now()) {
  const time = Date.parse(iso);
  const elapsed = now - time;

  if (!Number.isFinite(time)) {
    return '';
  }
  if (elapsed < MINUTE) {
    return 'Just now';
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)} min ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)} h ago`;
  }

  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export type DayGroup<T> = { items: T[]; label: 'Earlier' | 'This week' | 'Today' | 'Yesterday' };

/** Groups newest-first items into Today, Yesterday, This week and Earlier (local time). */
export function groupByDay<T extends { created_at: string }>(items: T[], now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  function labelFor(iso: string): DayGroup<T>['label'] {
    const time = Date.parse(iso);
    if (time >= startOfToday) {
      return 'Today';
    }
    if (time >= startOfToday - DAY) {
      return 'Yesterday';
    }
    if (time >= startOfToday - 6 * DAY) {
      return 'This week';
    }
    return 'Earlier';
  }

  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const label = labelFor(item.created_at);
    const current = groups[groups.length - 1];
    if (current?.label === label) {
      current.items.push(item);
    } else {
      groups.push({ items: [item], label });
    }
  }
  return groups;
}
