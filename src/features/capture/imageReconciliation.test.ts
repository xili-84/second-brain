import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeImageBackend,
  type FakeAttachment,
  type FakeObject,
} from '../../test/fakeImageBackend';
import { readPendingImageOperation, rememberPendingImageOperation } from './imageCapture';
import {
  IMAGE_RECONCILIATION_AGE_MS,
  RECONCILIATION_INTERVAL_MS,
  reconcileImageStorage,
} from './imageReconciliation';

const userId = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const now = Date.parse('2026-10-26T12:00:00.000Z');
const old = new Date(now - 2 * IMAGE_RECONCILIATION_AGE_MS).toISOString();
const fresh = new Date(now - 60_000).toISOString();
const clock = () => now;

function pad(index: number) {
  return String(index).padStart(5, '0');
}

function imageFixture(count: number) {
  const attachments: FakeAttachment[] = [];
  const objects: FakeObject[] = [];

  for (let index = 0; index < count; index += 1) {
    const path = `${userId}/capture-${pad(index)}/attachment-${pad(index)}.png`;
    attachments.push({
      capture_id: `capture-${pad(index)}`,
      id: `attachment-${pad(index)}`,
      storage_path: path,
      user_id: userId,
    });
    objects.push({ created_at: old, path });
  }

  return { attachments, objects };
}

afterEach(() => {
  localStorage.clear();
});

describe('image reconciliation safety', () => {
  it('removes only old, unreferenced objects', async () => {
    const referenced = `${userId}/folder/referenced.png`;
    const orphaned = `${userId}/folder/orphaned.png`;
    const young = `${userId}/folder/young.png`;
    const backend = createFakeImageBackend(
      [{ capture_id: 'folder', id: 'a1', storage_path: referenced, user_id: userId }],
      [
        { created_at: old, path: referenced },
        { created_at: old, path: orphaned },
        { created_at: fresh, path: young },
      ],
    );

    const outcome = await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(outcome.status).toBe('completed');
    expect(backend.removedPaths).toEqual([orphaned]);
  });

  it('never deletes referenced images when there are more than 1,000 attachments', async () => {
    const { attachments, objects } = imageFixture(2500);
    const orphaned = `${userId}/capture-99999/stray.png`;
    const backend = createFakeImageBackend(attachments, [
      ...objects,
      { created_at: old, path: orphaned },
    ]);

    const outcome = await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(outcome.status).toBe('completed');
    expect(backend.removedPaths).toEqual([orphaned]);
  });

  it('keeps paging correctly when the server caps rows below the page size', async () => {
    const { attachments, objects } = imageFixture(1500);
    const backend = createFakeImageBackend(attachments, objects, { maxRows: 100 });

    const outcome = await reconcileImageStorage(backend.client, userId, { now: clock });

    // Paging still completes because it follows the exact count rather than page length.
    expect(outcome.status).toBe('completed');
    expect(backend.removedPaths).toEqual([]);
  });

  it('skips without deleting when attachment metadata cannot be listed', async () => {
    const { objects } = imageFixture(3);
    const backend = createFakeImageBackend([], objects, { attachmentError: true });

    const outcome = await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(outcome.status).toBe('skipped-unsafe');
    expect(backend.remove).not.toHaveBeenCalled();
  });

  it('skips without deleting when candidates cannot be re-verified', async () => {
    const backend = createFakeImageBackend(
      [],
      [{ created_at: old, path: `${userId}/folder/orphaned.png` }],
      { verifyError: true },
    );

    const outcome = await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(outcome.status).toBe('skipped-unsafe');
    expect(backend.remove).not.toHaveBeenCalled();
  });

  it('runs at most once per day per user', async () => {
    const orphaned = `${userId}/folder/orphaned.png`;
    const backend = createFakeImageBackend([], [{ created_at: old, path: orphaned }]);

    expect((await reconcileImageStorage(backend.client, userId, { now: clock })).status).toBe(
      'completed',
    );
    expect(
      (await reconcileImageStorage(backend.client, userId, { now: () => now + 60_000 })).status,
    ).toBe('skipped-recent');
    expect(backend.client.from).toHaveBeenCalledTimes(2);
    expect(
      (
        await reconcileImageStorage(backend.client, userId, {
          now: () => now + RECONCILIATION_INTERVAL_MS + 1,
        })
      ).status,
    ).toBe('completed');
  });

  it('leaves a young pending marker and its object alone', async () => {
    const path = `${userId}/capture-x/attachment-x.png`;
    rememberPendingImageOperation(
      {
        attachmentId: 'attachment-x',
        captureId: 'capture-x',
        createdAt: old,
        storagePath: path,
        userId,
      },
      new Date(now - 30_000),
    );
    const backend = createFakeImageBackend([], [{ created_at: fresh, path }]);

    await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(backend.remove).not.toHaveBeenCalled();
    expect(readPendingImageOperation()?.storagePath).toBe(path);
  });

  it('cleans up an old unfinished pending marker', async () => {
    const path = `${userId}/capture-x/attachment-x.png`;
    rememberPendingImageOperation(
      {
        attachmentId: 'attachment-x',
        captureId: 'capture-x',
        createdAt: old,
        storagePath: path,
        userId,
      },
      new Date(old),
    );
    const backend = createFakeImageBackend([], [{ created_at: old, path }]);

    await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(backend.removedPaths).toEqual([path]);
    expect(readPendingImageOperation()).toBeNull();
  });

  it('clears an old marker without deleting when its attachment was finalized', async () => {
    const path = `${userId}/capture-x/attachment-x.png`;
    rememberPendingImageOperation(
      {
        attachmentId: 'attachment-x',
        captureId: 'capture-x',
        createdAt: old,
        storagePath: path,
        userId,
      },
      new Date(old),
    );
    const backend = createFakeImageBackend(
      [{ capture_id: 'capture-x', id: 'attachment-x', storage_path: path, user_id: userId }],
      [{ created_at: old, path }],
    );

    await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(backend.remove).not.toHaveBeenCalled();
    expect(readPendingImageOperation()).toBeNull();
  });

  it('removes only the unreferenced objects of a multi-image marker', async () => {
    const cover = `${userId}/capture-m/cover.png`;
    const attached = `${userId}/capture-m/second.png`;
    const orphan = `${userId}/capture-m/third.png`;
    rememberPendingImageOperation(
      {
        additionalPaths: [attached, orphan],
        attachmentId: 'cover',
        captureId: 'capture-m',
        createdAt: old,
        storagePath: cover,
        userId,
      },
      new Date(old),
    );
    const backend = createFakeImageBackend(
      [
        { capture_id: 'capture-m', id: 'cover', storage_path: cover, user_id: userId },
        { capture_id: 'capture-m', id: 'second', storage_path: attached, user_id: userId },
      ],
      [
        { created_at: old, path: cover },
        { created_at: old, path: attached },
        { created_at: old, path: orphan },
      ],
    );

    await reconcileImageStorage(backend.client, userId, { now: clock });

    expect(backend.removedPaths).toEqual([orphan]);
    expect(readPendingImageOperation()).toBeNull();
  });
});
