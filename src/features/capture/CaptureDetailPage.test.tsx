import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { CaptureDetailPage } from './CaptureDetailPage';
import { validateImageFile } from './imageCapture';
import { applyImageEdits } from './imageEdits';
import { isNativeImageSaveAvailable, saveImageToPhone } from './nativeImageSaver';

vi.mock('./imageCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageCapture')>();
  return { ...actual, validateImageFile: vi.fn() };
});

vi.mock('./imageEdits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageEdits')>();
  return { ...actual, applyImageEdits: vi.fn() };
});

vi.mock('./nativeImageSaver', () => ({
  isNativeImageSaveAvailable: vi.fn(() => false),
  saveImageToPhone: vi.fn(),
}));

type TestCapture = {
  attachments: {
    created_at?: string;
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

const receipt = {
  created_at: '2026-07-24T12:00:00.000Z',
  id: 'attachment-id',
  mime_type: 'image/png',
  original_name: 'receipt.png',
  size_bytes: 2048,
  storage_path: 'user/capture-id/attachment-id.png',
};

const postAttachment = {
  created_at: '2026-07-24T12:00:00.001Z',
  id: 'post-id',
  mime_type: 'image/jpeg',
  original_name: 'post.jpg',
  size_bytes: 4,
  storage_path: 'user/capture-id/post-id.jpg',
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
    vi.mocked(applyImageEdits).mockReset();
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

  it('lets an image edit be canceled without changing the published image', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [receipt],
      content: 'Receipt details',
      kind: 'image',
      title: 'Private receipt',
    };
    const { client, updateCall } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    expect(await screen.findByRole('img', { name: 'Private receipt' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    // The only image cannot be removed; more can be added.
    expect(screen.getByRole('img', { name: 'Preview of receipt.png' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Remove image 1/u })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Add images'), {
      target: { files: [new File(['post'], 'post.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByRole('img', { name: 'Preview of post.jpg' })).toBeVisible();
    expect(screen.getByText('2 of 10')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('img', { name: 'Private receipt' })).toBeVisible();
    expect(screen.queryByRole('img', { name: 'Preview of post.jpg' })).not.toBeInTheDocument();
    expect(updateCall).not.toHaveBeenCalled();
    expect(applyImageEdits).not.toHaveBeenCalled();
  });

  it('adds an image while editing and shows both in a gallery', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [receipt],
      content: 'Receipt details',
      kind: 'image',
      title: 'Private receipt',
    };
    const post = new File(['post'], 'post.jpg', { type: 'image/jpeg' });
    const { client } = createDetailClient({
      loadedCapture: imageCapture,
      updateResult: { data: imageCapture, error: null },
    });
    vi.mocked(applyImageEdits).mockResolvedValue({
      attachments: [receipt, postAttachment],
      error: null,
      failedKeys: [],
      saved: true,
      warning: null,
    });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Add images'), { target: { files: [post] } });
    await screen.findByRole('img', { name: 'Preview of post.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(applyImageEdits).toHaveBeenCalledTimes(1));
    const [, userId, captureId, current, next] = vi.mocked(applyImageEdits).mock.calls[0]!;
    expect(userId).toBe('8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d');
    expect(captureId).toBe('capture-id');
    expect(current).toEqual([receipt]);
    expect(next.map((image) => image.kind)).toEqual(['stored', 'new']);
    expect(next[1]).toMatchObject({ file: post, kind: 'new' });

    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved. Images updated.');
    expect(screen.getByRole('img', { name: 'Private receipt, image 1 of 2' })).toBeVisible();
    expect(screen.getByText('1 / 2')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByRole('img', { name: 'Private receipt, image 2 of 2' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show image 2 of 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByText(/post\.jpg · 0\.0 MB/u)).toBeVisible();
  });

  it('keeps the edit open and reports failed uploads', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [receipt],
      kind: 'image',
      title: 'Private receipt',
    };
    const { client } = createDetailClient({
      loadedCapture: imageCapture,
      updateResult: { data: imageCapture, error: null },
    });
    vi.mocked(applyImageEdits).mockResolvedValue({
      attachments: null,
      error: '1 of 1 new image did not upload. Nothing was changed; retry or remove it.',
      failedKeys: ['x'],
      saved: false,
      warning: null,
    });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Add images'), {
      target: { files: [new File(['post'], 'post.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByRole('img', { name: 'Preview of post.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Text changes were saved, but 1 of 1 new image did not upload.',
    );
    expect(screen.getByRole('img', { name: 'Preview of post.jpg' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('opens a full-screen viewer that moves with arrow keys and closes with Escape', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [postAttachment, receipt],
      kind: 'image',
      title: 'Story and post',
    };
    const { client } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    // Shown in stored order (oldest first), whatever order the API returned.
    const cover = await screen.findByRole('img', { name: 'Story and post, image 1 of 2' });
    expect(screen.getByText(/receipt\.png/u)).toBeVisible();
    fireEvent.click(cover);

    const viewer = screen.getByRole('dialog', { name: 'Image 1 of 2' });
    expect(within(viewer).getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Image 2 of 2' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The page gallery follows the image the viewer was closed on.
    expect(screen.getByRole('img', { name: 'Story and post, image 2 of 2' })).toBeVisible();
  });

  it('downloads the current image through a signed link in the browser', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [receipt],
      kind: 'image',
      title: 'Private receipt',
    };
    const { client, createSignedUrl } = createDetailClient({ loadedCapture: imageCapture });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderDetail(client);

    await screen.findByRole('img', { name: 'Private receipt' });
    fireEvent.click(screen.getByRole('button', { name: 'Download image' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createSignedUrl).toHaveBeenLastCalledWith(receipt.storage_path, 300, {
      download: 'receipt.png',
    });
    click.mockRestore();
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

  it('removes every image of a multi-image capture before deleting its records', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [receipt, postAttachment],
      kind: 'image',
      title: 'Story and post',
    };
    const { client, remove, rpc } = createDetailClient({ loadedCapture: imageCapture });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Story and post, image 1 of 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith([receipt.storage_path, postAttachment.storage_path]);
    expect(remove.mock.invocationCallOrder[0]!).toBeLessThan(rpc.mock.invocationCallOrder[0]!);
  });

  it('saves the image on screen, not just the first, to the phone', async () => {
    const imageCapture: TestCapture = {
      ...capture,
      attachments: [receipt, postAttachment],
      kind: 'image',
      title: 'Story and post',
    };
    const { client } = createDetailClient({ loadedCapture: imageCapture });
    vi.mocked(isNativeImageSaveAvailable).mockReturnValue(true);
    vi.mocked(saveImageToPhone).mockResolvedValue({ location: 'Pictures/Second Brain' });
    renderDetail(client);

    await screen.findByRole('img', { name: 'Story and post, image 1 of 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Show image 2 of 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save to phone' }));

    await waitFor(() =>
      expect(saveImageToPhone).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'post.jpg', mimeType: 'image/jpeg' }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Saved to phone' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show image 1 of 2' }));
    expect(screen.getByRole('button', { name: 'Save to phone' })).toBeEnabled();
  });
});
