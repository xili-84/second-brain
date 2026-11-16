import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import {
  isNativeFileSaveAvailable,
  openSavedFile,
  saveFileToPhone,
} from '../files/nativeFileSaver';
import { CaptureDetailPage } from './CaptureDetailPage';
import { applyImageEdits } from './imageEdits';

vi.mock('./imageEdits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageEdits')>();
  return { ...actual, applyImageEdits: vi.fn() };
});

vi.mock('../files/nativeFileSaver', () => ({
  isNativeFileSaveAvailable: vi.fn(() => false),
  openSavedFile: vi.fn(),
  saveFileToPhone: vi.fn(),
}));

const report = {
  created_at: '2026-11-16T12:00:00.000Z',
  id: 'report-id',
  mime_type: 'application/pdf',
  original_name: 'Quarterly report.pdf',
  size_bytes: 2_516_582,
  storage_path: 'user/file-capture/report-id.pdf',
};

const app = {
  created_at: '2026-11-16T12:00:00.001Z',
  id: 'app-id',
  mime_type: 'application/vnd.android.package-archive',
  original_name: 'second-brain.apk',
  size_bytes: 8_388_608,
  storage_path: 'user/file-capture/app-id.apk',
};

type Attachment = typeof report;

function fileCapture(attachments: Attachment[] = [report, app]) {
  return {
    attachments,
    content: 'For Monday',
    created_at: '2026-11-16T12:00:00.000Z',
    id: 'file-capture',
    kind: 'file',
    source_url: null,
    status: 'inbox',
    title: 'Papers',
    updated_at: '2026-11-16T12:00:00.000Z',
  };
}

function renderDetail(client: SecondBrainClient) {
  const session = {
    access_token: 'token',
    user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' },
  } as unknown as Session;
  render(
    <MemoryRouter initialEntries={['/captures/file-capture']}>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <Routes>
          <Route path="/captures/:captureId" element={<CaptureDetailPage />} />
          <Route path="/inbox" element={<h1>Inbox destination</h1>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function createClient(loaded = fileCapture()) {
  const deleteCall = vi.fn();
  const from = vi.fn().mockImplementation(() => {
    let operation: 'delete' | 'load' | 'update' = 'load';
    const builder = {
      delete: deleteCall.mockImplementation(() => {
        operation = 'delete';
        return builder;
      }),
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      single: vi.fn(() =>
        Promise.resolve(
          operation === 'delete'
            ? { data: { id: loaded.id }, error: null }
            : { data: loaded, error: null },
        ),
      ),
      update: vi.fn(() => {
        operation = 'update';
        return builder;
      }),
    };
    return builder;
  });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const list = vi.fn().mockResolvedValue({ data: [], error: null });
  const createSignedUrl = vi
    .fn()
    .mockResolvedValue({ data: { signedUrl: 'https://project.supabase.co/signed' }, error: null });
  const rpc = vi.fn();
  const client = {
    from,
    rpc,
    storage: { from: vi.fn().mockReturnValue({ createSignedUrl, list, remove }) },
  } as unknown as SecondBrainClient;
  return { client, createSignedUrl, deleteCall, list, remove, rpc };
}

function cards() {
  return within(screen.getByRole('list', { name: 'Attached files' })).getAllByRole('listitem');
}

describe('file capture detail', () => {
  beforeEach(() => {
    vi.mocked(applyImageEdits).mockReset();
    vi.mocked(isNativeFileSaveAvailable).mockReturnValue(false);
    vi.mocked(saveFileToPhone).mockReset();
    vi.mocked(openSavedFile).mockReset();
  });

  it('shows every file as a card with its name, type and size, and the note', async () => {
    const { client, createSignedUrl } = createClient();
    renderDetail(client);

    expect(await screen.findByRole('heading', { name: 'Papers' })).toBeVisible();
    expect(cards()).toHaveLength(2);
    expect(within(cards()[0]!).getByText('Quarterly report.pdf')).toBeVisible();
    expect(within(cards()[0]!).getByText('PDF')).toBeVisible();
    expect(within(cards()[0]!).getByText('2.4 MB')).toBeVisible();
    expect(within(cards()[1]!).getByText('APK')).toBeVisible();
    expect(within(cards()[1]!).getByText('8 MB')).toBeVisible();
    expect(screen.getByText('For Monday')).toBeVisible();
    // Nothing is signed until a file is actually downloaded.
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('downloads through a short signed link under the original name in a browser', async () => {
    const { client, createSignedUrl } = createClient();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });

    fireEvent.click(screen.getByRole('button', { name: 'Download Quarterly report.pdf' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createSignedUrl).toHaveBeenCalledWith('user/file-capture/report-id.pdf', 300, {
      download: 'Quarterly report.pdf',
    });
    click.mockRestore();
  });

  it('says so when a download link cannot be created', async () => {
    const { client, createSignedUrl } = createClient();
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } });
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });

    fireEvent.click(screen.getByRole('button', { name: 'Download second-brain.apk' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The download link could not be created',
    );
  });

  it('saves to Downloads in the Android app, then offers to open it (not for an APK)', async () => {
    vi.mocked(isNativeFileSaveAvailable).mockReturnValue(true);
    vi.mocked(saveFileToPhone).mockResolvedValue({
      location: 'Downloads/Second Brain',
      uri: 'content://media/external/downloads/42',
    });
    vi.mocked(openSavedFile).mockResolvedValue(undefined);
    const { client, createSignedUrl } = createClient();
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });

    fireEvent.click(screen.getByRole('button', { name: 'Save Quarterly report.pdf to phone' }));

    expect(await screen.findByText('Saved to Downloads/Second Brain.')).toBeVisible();
    expect(createSignedUrl).toHaveBeenCalledWith('user/file-capture/report-id.pdf', 300);
    expect(saveFileToPhone).toHaveBeenCalledWith({
      expectedSize: report.size_bytes,
      fileName: 'Quarterly report.pdf',
      mimeType: 'application/pdf',
      url: 'https://project.supabase.co/signed',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Quarterly report.pdf' }));
    await waitFor(() =>
      expect(openSavedFile).toHaveBeenCalledWith({
        mimeType: 'application/pdf',
        uri: 'content://media/external/downloads/42',
      }),
    );

    vi.mocked(saveFileToPhone).mockResolvedValue({
      location: 'Downloads/Second Brain',
      uri: 'content://media/external/downloads/43',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save second-brain.apk to phone' }));
    expect(
      await screen.findByText(
        'Saved to Downloads/Second Brain. Open it from your Files app to install.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open second-brain.apk' })).not.toBeInTheDocument();
  });

  it('reports a failed save to the phone', async () => {
    vi.mocked(isNativeFileSaveAvailable).mockReturnValue(true);
    vi.mocked(saveFileToPhone).mockRejectedValue(new Error('x'));
    const { client } = createClient();
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });

    fireEvent.click(screen.getByRole('button', { name: 'Save Quarterly report.pdf to phone' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file could not be saved to your phone',
    );
  });

  it('removes every stored file before deleting the capture row', async () => {
    const { client, deleteCall, list, remove, rpc } = createClient();
    list
      .mockResolvedValueOnce({
        data: [{ id: '2', name: 'stray.bin' }],
        error: null,
      })
      .mockResolvedValue({ data: [], error: null });
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/its private files are removed permanently/u)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByRole('heading', { name: 'Inbox destination' })).toBeVisible();
    const removed = remove.mock.calls[0]![0] as string[];
    expect(new Set(removed)).toEqual(
      new Set([
        'user/file-capture/report-id.pdf',
        'user/file-capture/app-id.apk',
        '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d/file-capture/stray.bin',
      ]),
    );
    expect(deleteCall).toHaveBeenCalled();
    // File captures have no guarding database function; the row is deleted directly.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not delete the capture when its files cannot be removed', async () => {
    const { client, deleteCall, remove } = createClient();
    remove.mockResolvedValue({ data: null, error: { message: 'storage down' } });
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The private files were not removed. Nothing else was deleted; please retry.',
    );
    expect(deleteCall).not.toHaveBeenCalled();
  });

  it('edits the file list: add, remove and save through the shared edit path', async () => {
    vi.mocked(applyImageEdits).mockImplementation(async () => ({
      attachments: [report],
      error: null,
      failedKeys: [],
      saved: true,
      warning: null,
    }));
    const { client } = createClient();
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove second-brain.apk' }));
    fireEvent.change(screen.getByLabelText('Add files'), {
      target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] },
    });
    await screen.findByText('2 of 10');
    // The last file cannot be removed in the editor (a capture keeps at least one).
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(applyImageEdits).toHaveBeenCalledTimes(1));
    const [, , captureId, current, next, options] = vi.mocked(applyImageEdits).mock.calls[0]!;
    expect(captureId).toBe('file-capture');
    expect(current.map((attachment) => attachment.id)).toEqual(['report-id', 'app-id']);
    expect(
      next.map((item) => [item.kind, item.kind === 'new' ? item.file.name : item.attachment.id]),
    ).toEqual([
      ['stored', 'report-id'],
      ['new', 'notes.txt'],
    ]);
    expect(options).toMatchObject({ mode: 'file' });
    expect(await screen.findByText('Changes saved. Files updated.')).toBeVisible();
  });

  it('refuses a file over 50 MB in the editor', async () => {
    const { client } = createClient();
    renderDetail(client);
    await screen.findByRole('heading', { name: 'Papers' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const huge = new File(['x'], 'disk.img', { type: 'application/octet-stream' });
    Object.defineProperty(huge, 'size', { value: 70 * 1024 * 1024 });

    fireEvent.change(screen.getByLabelText('Add files'), { target: { files: [huge] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'disk.img is 70 MB. Files can be up to 50 MB.',
    );
    expect(screen.getByText('2 of 10')).toBeVisible();
  });
});
