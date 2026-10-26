export type CaptureStatus = 'archived' | 'inbox' | 'reviewed';

export const captureStatusDetails: Record<
  CaptureStatus,
  { emptyMessage: string; label: string; path: string }
> = {
  inbox: {
    emptyMessage: 'You’re all caught up',
    label: 'Inbox',
    path: '/inbox',
  },
  reviewed: {
    emptyMessage: 'Nothing reviewed yet',
    label: 'Reviewed',
    path: '/reviewed',
  },
  archived: {
    emptyMessage: 'The archive is empty',
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
