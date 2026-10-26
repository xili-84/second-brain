import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { CaptureDetailPage } from './CaptureDetailPage';
import { validateImageFile } from './imageCapture';
import { replaceImageAttachment } from './imageReplacement';
import { isNativeImageSaveAvailable, saveImageToPhone } from './nativeImageSaver';

vi.mock('./imageCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageCapture')>();
  return { ...actual, validateImageFile: vi.fn() };
});

vi.mock('./imageReplacement', () => ({
  replaceImageAttachment: vi.fn(),
}));

vi.mock('./nativeImageSaver', () => ({
  isNativeImageSaveAvailable: vi.fn(() => false),
  saveImageToPhone: vi.fn(),
}));

type TestCapture = {
  attachments: {
    id: string;
    mime_type: string;
    original_name: string;
    size_bytes: number;
    storage_path: string;
  }[];
  content: string | null;
  created_at: string;
  id: string;
  kind: string;
  source_url: string | null;
  status: string;
  title: string | null;
  updated_at: string;
};

const capture: TestCapture = {
  attachments: [],
  content: 'Original note',
  created_at: '2026-07-24T12:00:00.000Z',
  id: 'capture-id',
  kind: 'note',
  source_url: null,
  status: 'inbox',
  title: 'A useful thought',
  updated_at: '2026-07-24T12:00:00.000Z',
};

function renderDetail(client: SecondBrainClient) {
  const createSession = (accessToken: string) =>
    ({
      access_token: accessToken,
      user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' },
    }) as unknown as Session;
  const renderApp = (session: Session) => (
    <MemoryRouter initialEntries={['/captures/capture-id']}>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <Routes>
          <Route path="/captures/:captureId" element={<CaptureDetailPage />} />
          <Route path="/inbox" element={<h1>Inbox destination</h1>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
  const view = render(renderApp(createSession('initial-token')));

  return {
    ...view,
    refreshSession: () => view.rerender(renderApp(createSession('refreshed-token'))),
  };
}

function createDetailClient({
  deleteResult = { data: { id: capture.id }, error: null },
  folderObjectNames = [],
  loadedCapture = capture,
  removeResult = { data: [], error: null },
  rpcResult = { data: true, error: null },
  updateResult = { data: capture, error: null },
}: {
  deleteResult?: { data: { id: string } | null; error: { message: string } | null };
  folderObjectNames?: string[];
  loadedCapture?: TestCapture;
  removeResult?: { data: unknown[]; error: { message: string } | null };
  rpcResult?: { data: boolean | null; error: { message: string } | null };
  updateResult?: { data: TestCapture | null; error: { message: string } | null };
} = {}) {
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
      single: vi.fn(() => {
        if (operation === 'delete') {
          return Promise.resolve(deleteResult);
        }

        if (operation === 'update') {
          return Promise.resolve(updateResult);
        }

        return Promise.resolve({ data: loadedCapture, error: null });
      }),
      update: updateCall.mockImplementation(() => {
        operation = 'update';
        return builder;
      }),
    };
    return builder;
  });
  const remove = vi.fn().mockResolvedValue(removeResult);
  const list = vi
    .fn()
    .mockResolvedValueOnce({
      data: folderObjectNames.map((name) => ({ id: `id-${name}`, name })),
      error: null,
    })
    .mockResolvedValue({ data: [], error: null });
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: 'https://storage.example/private-image' },
    error: null,
  });
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const updateCall = vi.fn();

  const client = {
    from,
    rpc,
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl,
        list,
        remove,
      }),
    },
  } as unknown as SecondBrainClient;

  return { client, createSignedUrl, deleteCall, from, list, remove, rpc, updateCall };
}

describe('capture detail', () => {
  const execCommand = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    vi.mocked(validateImageFile).mockReset();
    vi.mocked(validateImageFile).mockResolvedValue(null);
    vi.mocked(replaceImageAttachment).mockReset();
    vi.mocked(isNativeImageSaveAvailable).mockReturnValue(false);
    vi.mocked(saveImageToPhone).mockReset();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    execCommand.mockReset();
    execCommand.mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('opens in reading mode and discards canceled edits', async () => {
    const { client } = createDetailClient();
    renderDetail(client);

    expect(await screen.findByText('Original note')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const note = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(note, { target: { value: 'Changed but not saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Original note')).toBeVisible();
    expect(screen.queryByText('Changed but not saved')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
  });

  it('retains an unsaved edit when the authenticated session token refreshes', async () => {
    const { client, from } = createDetailClient();
    const { refreshSession } = renderDetail(client);

    await screen.findByText('Original note');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Draft survives tab activation' },
    });

    refreshSession();

    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(
      'Draft survives tab activation',
    );
    // The capture is not reloaded (the tag list for autocomplete is a separate table).
    expect(from.mock.calls.filter(([table]) => table === 'captures')).toHaveLength(1);
  });

  it('copies only the opened note content', async () => {
    const { client } = createDetailClient();
    renderDetail(client);

    await screen.findByText('Original note');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Original note'));
    expect(writeText).not.toHaveBeenCalledWith('A useful thought');
    expect(await screen.findByRole('status')).toHaveTextContent('Content copied to clipboard.');
  });

  it('uses compact accessible detail actions in the native app', async () => {
    const { client } = createDetailClient();
    vi.mocked(isNativeImageSaveAvailable).mockReturnValue(true);
    renderDetail(client);

    await screen.findByText('Original note');

    const back = screen.getByRole('link', { name: 'Back to inbox' });
    expect(back).toHaveAttribute('href', '/inbox');
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    // Icon-only header actions keep a visible-on-hover title and a real accessible name.
    for (const name of ['Copy content', 'Edit', 'Delete']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('icon-btn');
      expect(button).toHaveAttribute('title', name);
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }

    const actions = screen.getByRole('group', { name: 'Organize' });
    expect(within(actions).getByRole('button', { name: 'Archive' })).toBeEnabled();
    expect(within(actions).getByRole('button', { name: 'Mark reviewed' })).toBeEnabled();
  });

  it('copies the text attached to an image capture', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      content: 'Receipt details',
      kind: 'image',
      title: 'Private receipt',
    };
    const { client } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Receipt details'));
    expect(writeText).not.toHaveBeenCalledWith('Private receipt');
  });

  it('falls back to a compatible copy command for image captures', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      content: 'Receipt details',
      kind: 'image',
      title: 'Private receipt',
    };
    const { client } = createDetailClient({ loadedCapture: imageCapture });
    writeText.mockRejectedValue(new Error('clipboard denied'));
    execCommand.mockReturnValue(true);
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(await screen.findByRole('status')).toHaveTextContent('Content copied to clipboard.');
  });

  it('reports clipboard failures without changing the note', async () => {
    const { client } = createDetailClient();
    writeText.mockRejectedValue(new Error('clipboard denied'));
    renderDetail(client);

    await screen.findByText('Original note');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The content could not be copied');
    expect(screen.getByText('Original note')).toBeVisible();
  });

  it('lets an image removal be canceled without changing the published image', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      content: 'Receipt details',
      kind: 'image',
      title: 'Private receipt',
    };
    const { client, updateCall } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    expect(await screen.findByRole('img', { name: 'Private receipt' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace image' }));

    expect(screen.queryByRole('img', { name: 'Private receipt' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Replacement image')).toBeInTheDocument();
    expect(
      screen.getByText('The published image is unchanged until Save changes succeeds.'),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('img', { name: 'Private receipt' })).toBeVisible();
    expect(screen.queryByLabelText('Replacement image')).not.toBeInTheDocument();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('requires a replacement file before saving an image removal', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      content: 'Receipt details',
      kind: 'image',
      title: 'Private receipt',
    };
    const { client, updateCall } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a replacement image before saving',
    );
    expect(screen.getByLabelText('Replacement image')).toBeInTheDocument();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('replaces the attachment and returns to the updated reading view', async () => {
    const oldAttachment = {
      id: 'attachment-id',
      mime_type: 'image/png',
      original_name: 'receipt.png',
      size_bytes: 2048,
      storage_path: 'user/capture-id/attachment-id.png',
    };
    const newAttachment = {
      ...oldAttachment,
      mime_type: 'image/webp',
      original_name: 'replacement.webp',
      size_bytes: 11,
      storage_path: 'user/capture-id/replacement.webp',
    };
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [oldAttachment],
      content: 'Receipt details',
      kind: 'image',
      title: 'Private receipt',
    };
    const replacement = new File(['replacement'], 'replacement.webp', {
      type: 'image/webp',
    });
    const { client } = createDetailClient({
      loadedCapture: imageCapture,
      updateResult: { data: imageCapture, error: null },
    });
    vi.mocked(replaceImageAttachment).mockResolvedValue({
      attachment: newAttachment,
      error: null,
      replaced: true,
      warning: null,
    });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace image' }));
    fireEvent.change(screen.getByLabelText('Replacement image'), {
      target: { files: [replacement] },
    });
    await screen.findByText(/Selected: replacement\.webp/);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(replaceImageAttachment).toHaveBeenCalledWith(
        client,
        '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d',
        'capture-id',
        oldAttachment,
        replacement,
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved. Image replaced.');
    expect(screen.getByRole('img', { name: 'Private receipt' })).toBeVisible();
    expect(screen.queryByLabelText('Replacement image')).not.toBeInTheDocument();
  });

  it('keeps edited content available when saving fails', async () => {
    const { client, updateCall } = createDetailClient({
      updateResult: { data: null, error: { message: 'network unavailable' } },
    });
    renderDetail(client);

    await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const note = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(note, { target: { value: 'Unsaved but retained' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Changes were not saved');
    expect(note).toHaveValue('Unsaved but retained');
    expect(updateCall).toHaveBeenCalledWith({
      content: 'Unsaved but retained',
      source_url: null,
      title: 'A useful thought',
    });
    expect(screen.queryByText('Changes saved.')).not.toBeInTheDocument();
  });

  it('returns to reading mode after an edit is saved', async () => {
    const savedCapture = { ...capture, content: 'Updated and saved note' };
    const { client } = createDetailClient({
      updateResult: { data: savedCapture, error: null },
    });
    renderDetail(client);

    await screen.findByText('Original note');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Updated and saved note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Changes saved.')).toBeVisible();
    expect(screen.getByRole('article', { name: 'note content' })).toHaveTextContent(
      'Updated and saved note',
    );
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
  });

  it('requires explicit confirmation before permanently deleting', async () => {
    const { client, deleteCall } = createDetailClient();
    renderDetail(client);

    await screen.findByRole('heading', { name: 'A useful thought' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteCall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(deleteCall).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Inbox destination' })).toBeVisible();
  });

  it('focuses Cancel in the delete sheet and closes it with Escape', async () => {
    const { client, deleteCall } = createDetailClient();
    renderDetail(client);

    await screen.findByRole('heading', { name: 'A useful thought' });
    const trigger = screen.getByRole('button', { name: 'Delete' });
    trigger.focus();
    fireEvent.click(trigger);

    const sheet = screen.getByRole('alertdialog');
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(deleteCall).not.toHaveBeenCalled();
  });

  it('removes image Storage before deleting its database records', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      content: 'Receipt',
      kind: 'image',
      title: 'Private receipt',
    };
    const { client, remove, rpc } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith(['user/capture-id/attachment-id.png']);
    expect(remove.mock.invocationCallOrder[0]!).toBeLessThan(rpc.mock.invocationCallOrder[0]!);
    expect(rpc).toHaveBeenCalledWith('delete_image_capture_after_storage', {
      p_capture_id: 'capture-id',
    });
  });

  it('saves a private image to the Android Pictures album only after native confirmation', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      kind: 'image',
      title: 'Private receipt',
    };
    const { client } = createDetailClient({ loadedCapture: imageCapture });
    vi.mocked(isNativeImageSaveAvailable).mockReturnValue(true);
    vi.mocked(saveImageToPhone).mockResolvedValue({
      location: 'Pictures/Second Brain',
    });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Save to phone' }));

    await waitFor(() =>
      expect(saveImageToPhone).toHaveBeenCalledWith({
        expectedSize: 2048,
        fileName: 'receipt.png',
        mimeType: 'image/png',
        url: 'https://storage.example/private-image',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Image saved to Pictures/Second Brain.',
    );
    expect(screen.getByRole('button', { name: 'Saved to phone' })).toBeDisabled();
  });

  it('keeps image database records when Storage deletion fails', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      kind: 'image',
    };
    const { client, rpc } = createDetailClient({
      loadedCapture: imageCapture,
      removeResult: { data: [], error: { message: 'storage unavailable' } },
    });
    renderDetail(client);

    await screen.findByRole('img', { name: 'A useful thought' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing else was deleted');
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A useful thought' })).toBeVisible();
  });
  it('also removes stray objects in the capture folder before deleting records', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d/capture-id/attachment-id.png',
        },
      ],
      kind: 'image',
      title: 'Private receipt',
    };
    const { client, remove, rpc } = createDetailClient({
      folderObjectNames: ['attachment-id.png', 'old-replaced.png'],
      loadedCapture: imageCapture,
    });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith([
      '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d/capture-id/attachment-id.png',
      '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d/capture-id/old-replaced.png',
    ]);
  });

  it('re-signs an expired image link once when the image fails to load', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [
        {
          id: 'attachment-id',
          mime_type: 'image/png',
          original_name: 'receipt.png',
          size_bytes: 2048,
          storage_path: 'user/capture-id/attachment-id.png',
        },
      ],
      kind: 'image',
      title: 'Private receipt',
    };
    const { client, createSignedUrl } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    const image = await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.error(image);
    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledTimes(2));

    fireEvent.error(screen.getByRole('img', { name: 'Private receipt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
