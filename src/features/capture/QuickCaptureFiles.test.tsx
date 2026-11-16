import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import type { PendingShare } from '../share-target/nativeShare';
import { loadPendingSharedImage } from '../share-target/nativeShare';
import { PendingShareContext } from '../share-target/pendingShareContext';
import { saveFileCapture } from './fileCapture';
import { QuickCapturePage } from './QuickCapturePage';

vi.mock('./fileCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fileCapture')>();
  return { ...actual, saveFileCapture: vi.fn() };
});

vi.mock('../share-target/nativeShare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../share-target/nativeShare')>();
  return { ...actual, loadPendingSharedImage: vi.fn() };
});

const session = {
  user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' },
} as unknown as Session;

const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' });
const app = new File(['apk'], 'app-release.apk', {
  type: 'application/vnd.android.package-archive',
});

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

function chooseFiles(files: File[]) {
  fireEvent.click(screen.getByRole('radio', { name: 'File' }));
  fireEvent.change(screen.getByLabelText('Choose files'), { target: { files } });
}

function cardNames() {
  return within(screen.getByRole('region', { name: 'Files' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.file-card__name')?.textContent);
}

const saved = {
  error: null,
  failedKeys: [],
  saved: true,
  uploadedKeys: [],
  warning: null,
};

describe('file capture', () => {
  beforeEach(() => {
    vi.mocked(saveFileCapture).mockReset();
    vi.mocked(loadPendingSharedImage).mockReset();
  });

  it('picks files of any type, shows cards with type and size, and saves them', async () => {
    vi.mocked(saveFileCapture).mockResolvedValue(saved);
    renderCapture();

    chooseFiles([notes, app]);

    await screen.findByText('2 of 10');
    expect(cardNames()).toEqual(['notes.txt', 'app-release.apk']);
    expect(screen.getByText('TXT')).toBeVisible();
    expect(screen.getByText('APK')).toBeVisible();
    expect(screen.getByText('5 B')).toBeVisible();

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'keep these' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByText('Capture saved to your inbox.')).toBeVisible();
    const [, operation, draft] = vi.mocked(saveFileCapture).mock.calls[0]!;
    expect(operation.items.map((item) => item.file.name)).toEqual(['notes.txt', 'app-release.apk']);
    expect(operation.items.map((item) => item.storagePath.split('.').pop())).toEqual([
      'txt',
      'apk',
    ]);
    expect(draft).toMatchObject({ content: 'keep these', kind: 'file' });
  });

  it('gives a file with no type one from its extension', async () => {
    vi.mocked(saveFileCapture).mockResolvedValue(saved);
    renderCapture();

    chooseFiles([new File(['x'], 'budget.xlsx', { type: '' })]);
    await screen.findByText('1 of 10');
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));
    await screen.findByText('Capture saved to your inbox.');

    expect(vi.mocked(saveFileCapture).mock.calls[0]![1].items[0]!.file.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('turns a file over 50 MB away with a friendly message and keeps the rest', async () => {
    renderCapture();
    const huge = new File(['x'], 'movie.mkv', { type: 'video/x-matroska' });
    Object.defineProperty(huge, 'size', { value: 80 * 1024 * 1024 });

    chooseFiles([huge, notes]);

    await screen.findByText('1 of 10');
    expect(cardNames()).toEqual(['notes.txt']);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'movie.mkv is 80 MB. Files can be up to 50 MB.',
    );
  });

  it('refuses to save without a file', async () => {
    renderCapture();
    fireEvent.click(screen.getByRole('radio', { name: 'File' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose at least one file before saving.',
    );
    expect(saveFileCapture).not.toHaveBeenCalled();
  });

  it('keeps the draft after a failed upload, then retries only what failed', async () => {
    renderCapture();
    chooseFiles([notes, app]);
    await screen.findByText('2 of 10');

    vi.mocked(saveFileCapture).mockImplementationOnce(async (_client, operation) => ({
      error: '1 of 2 files did not upload. Retry, or remove them and save the rest.',
      failedKeys: [operation.items[1]!.key],
      saved: false,
      uploadedKeys: [operation.items[0]!.key],
      warning: null,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 of 2 files did not upload');
    expect(cardNames()).toHaveLength(2);

    vi.mocked(saveFileCapture).mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));
    await screen.findByText('Capture saved to your inbox.');

    const [first, second] = vi.mocked(saveFileCapture).mock.calls;
    expect(second![1]).toEqual(first![1]);
    expect([...(second![3]?.uploadedKeys ?? [])]).toEqual([first![1].items[0]!.key]);
  });

  it('reorders and removes files before saving', async () => {
    renderCapture();
    chooseFiles([notes, app]);
    await screen.findByText('2 of 10');

    fireEvent.click(screen.getByRole('button', { name: 'Move app-release.apk up' }));
    expect(cardNames()).toEqual(['app-release.apk', 'notes.txt']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    await screen.findByText('1 of 10');
    expect(cardNames()).toEqual(['app-release.apk']);
  });

  it('turns an Android share of files into one file draft', async () => {
    vi.mocked(loadPendingSharedImage)
      .mockResolvedValueOnce({ file: app })
      .mockResolvedValueOnce({ file: notes });
    renderCapture({
      id: 'share-1',
      images: [
        {
          index: 0,
          mimeType: 'application/vnd.android.package-archive',
          name: 'app-release.apk',
          size: 3,
          uri: 'file:///a',
        },
        { index: 1, mimeType: 'text/plain', name: 'notes.txt', size: 5, uri: 'file:///b' },
      ],
      kind: 'file',
      receivedAt: '2026-11-16T10:00:00.000Z',
      text: '',
      title: 'From Files',
    });

    await screen.findByText('2 of 10');
    expect(cardNames()).toEqual(['app-release.apk', 'notes.txt']);
    expect(screen.getByRole('radio', { name: 'File' })).toBeChecked();
    expect(screen.getByLabelText('Title')).toHaveValue('From Files');
    await waitFor(() => expect(loadPendingSharedImage).toHaveBeenCalledTimes(2));
  });
});
