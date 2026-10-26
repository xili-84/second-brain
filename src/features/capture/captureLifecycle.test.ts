import { describe, expect, it } from 'vitest';

import { getCaptureStatusUpdate } from './captureLifecycle';

describe('capture lifecycle updates', () => {
  it('sets an archive timestamp only for archived captures', () => {
    const now = new Date('2026-07-24T15:00:00.000Z');

    expect(getCaptureStatusUpdate('archived', now)).toEqual({
      archived_at: '2026-07-24T15:00:00.000Z',
      status: 'archived',
    });
    expect(getCaptureStatusUpdate('reviewed', now)).toEqual({
      archived_at: null,
      status: 'reviewed',
    });
    expect(getCaptureStatusUpdate('inbox', now)).toEqual({
      archived_at: null,
      status: 'inbox',
    });
  });
});
