import type { ReactNode } from 'react';

/** Read-only tags under a list row or search result. */
export function TagList({
  render,
  tags,
}: {
  render?: (name: string) => ReactNode;
  tags: readonly string[];
}) {
  if (!tags.length) {
    return null;
  }
  return (
    <ul aria-label="Tags" className="tag-list">
      {tags.map((name) => (
        <li className="tag-list__item" key={name}>
          #{render ? render(name) : name}
        </li>
      ))}
    </ul>
  );
}
