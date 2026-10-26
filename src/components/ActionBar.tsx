import type { ReactNode } from 'react';

/**
 * Primary actions for a focused screen. Pinned to the bottom (thumb zone) on phones, inline at
 * the end of the content on wide screens.
 */
export function ActionBar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div aria-label={label} className="action-bar glass" role="group">
      {children}
    </div>
  );
}
