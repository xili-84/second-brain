import { Archive, CircleCheck, Inbox, type LucideIcon } from 'lucide-react';

import type { CaptureStatus } from '../features/capture/captureLifecycle';

export type Section = {
  icon: LucideIcon;
  label: string;
  path: string;
  status: CaptureStatus;
};

export const sections: readonly Section[] = [
  { icon: Inbox, label: 'Inbox', path: '/inbox', status: 'inbox' },
  { icon: CircleCheck, label: 'Reviewed', path: '/reviewed', status: 'reviewed' },
  { icon: Archive, label: 'Archived', path: '/archived', status: 'archived' },
];

/** Router state a list passes to a capture link so navigation can keep its section highlighted. */
export type SectionState = { section?: string };

/** Screens with their own top bar and bottom actions hide the tab bar (and on mobile the masthead). */
export function isFocusedScreen(pathname: string) {
  return pathname === '/capture' || pathname.startsWith('/captures/');
}

/** The section a path belongs to; capture pages use the section they were opened from. */
export function activeSectionPath(pathname: string, state: unknown) {
  const section = sections.find((candidate) => candidate.path === pathname);
  if (section) {
    return section.path;
  }
  if (pathname.startsWith('/captures/')) {
    const from = (state as SectionState | null)?.section;
    return sections.some((candidate) => candidate.path === from) ? from : '/inbox';
  }
  return undefined;
}
