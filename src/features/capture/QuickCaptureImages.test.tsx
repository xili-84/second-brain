import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import type { PendingShare } from '../share-target/nativeShare';
import { loadPendingSharedImage } from '../share-target/nativeShare';
import { PendingShareContext } from '../share-target/pendingShareContext';
import { saveImageCapture, validateImageFile } from './imageCapture';
import { QuickCapturePage } from './QuickCapturePage';

vi.mock('./imageCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageCapture')>();
  return { ...actual, saveImageCapture: vi.fn(), validateImageFile: vi.fn() };
});

vi.mock('../share-target/nativeShare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../share-target/nativeShare')>();
  return { ...actual, loadPendingSharedImage: vi.fn() };
});

const session = {
  user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' },
} as unknown as Session;

const story = new File(['story'], 'story.png', { type: 'image/png' });
const post = new File(['post'], 'post.jpg', { type: 'image/jpeg' });

function renderCapture(pendingShare: PendingShare | null = null) {
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const client = {
    from: vi.fn(),
    storage: { from: vi.fn().mockReturnValue({ remove }) },
  } as unknown as SecondBrainClient;
  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <PendingShareContext.Provider
          value={{
            clearPendingShare: vi.fn().mockResolvedValue(undefined),
            error: null,
            pendingShare,
          }}
        >
          <QuickCapturePage />
        </PendingShareContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return { client, remove };
}

async function chooseImages(files: File[]) {
  fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
  fireEvent.change(screen.getByLabelText('Choose images'), { target: { files } });
  await screen.findByText(`${files.length > 10 ? 10 : files.length} of 10`);
}

function tileNames() {
  return within(screen.getByRole('region', { name: 'Images' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('aria-label'))
    .filter(Boolean);
}

describe('multi-image capture', () => {
  beforeEach(() => {
    vi.mocked(validateImageFile).mockReset();
    vi.mocked(validateImageFile).mockResolvedValue(null);
    vi.mocked(saveImageCapture).mockReset();
    vi.mocked(loadPendingSharedImage).mockReset();
  });

  it('picks several images, reorders and removes them before saving', async () => {
    vi.mocked(saveImageCapture).mockResolvedValue({
      error: null,
      failedKeys: [],
      saved: true,
      uploadedKeys: [],
      warning: null,
    });
    renderCapture();

    await chooseImages([story, post]);
    expect(tileNames()).toEqual(['story.png, image 1 of 2', 'post.jpg, image 2 of 2']);

    fireEvent.click(screen.getByRole('button', { name: 'Move image 2 of 2 earlier' }));
    expect(tileNames()).toEqual(['post.jpg, image 1 of 2', 'story.png, image 2 of 2']);

    // More can be added afterwards, then one removed again.
    fireEvent.change(screen.getByLabelText('Add images'), {
      target: { files: [new File(['x'], 'extra.webp', { type: 'image/webp' })] },
    });
    await screen.findByText('3 of 10');
    fireEvent.click(screen.getByRole('button', { name: 'Remove image 3 of 3' }));
    await screen.findByText('2 of 10');

    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByText('Capture saved to your inbox.')).toBeVisible();
    const operation = vi.mocked(saveImageCapture).mock.calls[0]![1];
    expect(operation.items.map((item) => item.file.name)).toEqual(['post.jpg', 'story.png']);
    expect(new Set(operation.items.map((item) => item.storagePath.split('/')[1]))).toEqual(
      new Set([operation.captureId]),
    );
  });

  it('keeps the draft after a partial upload failure and retries only what failed', async () => {
    renderCapture();
    await chooseImages([story, post]);

    vi.mocked(saveImageCapture).mockImplementationOnce(async (_client, operation) => ({
      error: '1 of 2 images did not upload. Retry, or remove them and save the rest.',
      failedKeys: [operation.items[1]!.key],
      saved: false,
      uploadedKeys: [operation.items[0]!.key],
      warning: null,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('1 of 2 images did not upload');
    expect(tileNames()).toHaveLength(2);

    vi.mocked(saveImageCapture).mockResolvedValueOnce({
      error: null,
      failedKeys: [],
      saved: true,
      uploadedKeys: [],
      warning: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    await screen.findByText('Capture saved to your inbox.');
    const [first, second] = vi.mocked(saveImageCapture).mock.calls;
    // The same capture and upload slots are reused, and the stored image is skipped.
    expect(second![1]).toEqual(first![1]);
    expect([...(second![3]?.uploadedKeys ?? [])]).toEqual([first![1].items[0]!.key]);
  });

  it('caps a capture at ten images and says which were left out', async () => {
    renderCapture();
    const files = Array.from(
      { length: 12 },
      (_, index) => new File([String(index)], `photo-${index + 1}.jpg`, { type: 'image/jpeg' }),
    );

    await chooseImages(files);

    expect(tileNames()).toHaveLength(10);
    expect(screen.queryByLabelText('Add images')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'photo-11.jpg: a capture holds up to 10 images.',
    );
  });

  it('turns an Android share of several images into one draft', async () => {
    vi.mocked(loadPendingSharedImage)
      .mockResolvedValueOnce({ file: story })
      .mockResolvedValueOnce({ file: post });
    renderCapture({
      error: '1 shared item was skipped: Only JPEG, PNG, and WebP images are supported.',
      id: 'share-1',
      images: [
        { index: 0, mimeType: 'image/png', name: 'story.png', size: 5, uri: 'file:///a' },
        { index: 1, mimeType: 'image/jpeg', name: 'post.jpg', size: 4, uri: 'file:///b' },
      ],
      kind: 'image',
      receivedAt: '2026-10-30T10:00:00.000Z',
      text: '',
      title: 'Launch post',
    });

    await screen.findByText('2 of 10');
    expect(tileNames()).toEqual(['story.png, image 1 of 2', 'post.jpg, image 2 of 2']);
    expect(loadPendingSharedImage).toHaveBeenNthCalledWith(
      2,
      'share-1',
      expect.objectContaining({ index: 1 }),
    );
    expect(screen.getByText(/1 shared item was skipped/u)).toBeVisible();
    // Native code already checked the files, so they are not decoded again.
    await waitFor(() => expect(validateImageFile).not.toHaveBeenCalled());
  });
});
