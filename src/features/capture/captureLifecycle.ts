export type CaptureStatus = 'archived' | 'inbox' | 'reviewed';

export const captureStatusDetails: Record<
  CaptureStatus,
  { emptyMessage: string; eyebrow: string; label: string; path: string }
> = {
  inbox: {
    emptyMessage: 'Your inbox is empty.',
    eyebrow: 'Organize later',
    label: 'Inbox',
    path: '/inbox',
  },
  reviewed: {
    emptyMessage: 'No reviewed captures yet.',
    eyebrow: 'Ready for reference',
    label: 'Reviewed',
    path: '/reviewed',
  },
  archived: {
    emptyMessage: 'Your archive is empty.',
    eyebrow: 'Out of the way',
    label: 'Archived',
    path: '/archived',
  },
};

export function getCaptureStatusUpdate(status: CaptureStatus, now = new Date()) {
  return {
    archived_at: status === 'archived' ? now.toISOString() : null,
    status,
  };
}
