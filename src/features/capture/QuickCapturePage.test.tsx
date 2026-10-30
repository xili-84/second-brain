import type { Session } from '@supabase/supabase-js';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { AuthContext } from '../auth/authContext';
import { PendingShareContext } from '../share-target/pendingShareContext';
import { QuickCapturePage } from './QuickCapturePage';

const session = {
  user: { id: '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d' },
} as unknown as Session;

function renderCapture(
  client: SecondBrainClient,
  clearPendingShare = vi.fn().mockResolvedValue(undefined),
) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <PendingShareContext.Provider
          value={{ clearPendingShare, error: null, pendingShare: null }}
        >
          <QuickCapturePage />
        </PendingShareContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function createInsertClient(result: Promise<{ data: { id: string } | null; error: Error | null }>) {
  const single = vi.fn().mockReturnValue(result);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const client = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SecondBrainClient;

  return { client, insert };
}

describe('quick capture persistence', () => {
  it('retains the complete draft and does not claim success when saving fails', async () => {
    const { client } = createInsertClient(
      Promise.resolve({ data: null, error: new Error('network unavailable') }),
    );
    renderCapture(client);

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Keep this thought for retry' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(
      'Keep this thought for retry',
    );
    expect(screen.queryByText('Capture saved to your inbox.')).not.toBeInTheDocument();
  });

  it('prevents duplicate submission while a save is in flight', async () => {
    let finishSave: ((value: { data: { id: string }; error: null }) => void) | undefined;
    const pendingResult = new Promise<{ data: { id: string }; error: null }>((resolve) => {
      finishSave = resolve;
    });
    const { client, insert } = createInsertClient(pendingResult);
    renderCapture(client);

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Save exactly once' },
    });

    const saveButton = screen.getByRole('button', { name: 'Save to inbox' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(insert).toHaveBeenCalledTimes(1);
    finishSave?.({ data: { id: 'capture-id' }, error: null });

    expect(await screen.findByText('Capture saved to your inbox.')).toBeVisible();
  });

  it('switches capture kinds with a segmented control and offers a way back', () => {
    const { client } = createInsertClient(Promise.resolve({ data: { id: 'x' }, error: null }));
    renderCapture(client);

    expect(screen.getByRole('heading', { level: 1, name: 'New capture' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '/inbox');
    const note = screen.getByRole('radio', { name: 'Note' });
    expect(note).toBeChecked();
    expect(note.closest('label')).toHaveClass('segmented__option--checked');

    fireEvent.click(screen.getByRole('radio', { name: 'Link' }));
    expect(screen.getByRole('textbox', { name: 'URL' })).toBeRequired();
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Link' }).closest('label')).toHaveClass(
      'segmented__option--checked',
    );
    expect(note.closest('label')).not.toHaveClass('segmented__option--checked');

    fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
    const picker = screen.getByLabelText('Choose images');
    expect(picker).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(picker).toHaveAttribute('multiple');
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeVisible();
  });

  it('asks for a link preview in the background once a link is saved', async () => {
    const { client, insert } = createInsertClient(
      Promise.resolve({ data: { id: 'x' }, error: null }),
    );
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    Object.assign(client, { functions: { invoke } });
    renderCapture(client);

    fireEvent.click(screen.getByRole('radio', { name: 'Link' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://example.com/story' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to inbox' }));

    expect(await screen.findByText('Capture saved to your inbox.')).toBeVisible();
    const savedId = (insert.mock.calls[0]![0] as { id: string }).id;
    expect(invoke).toHaveBeenCalledWith('link-preview', { body: { captureId: savedId } });
  });

  it('labels an Android share and says nothing is saved yet', () => {
    const { client } = createInsertClient(Promise.resolve({ data: { id: 'x' }, error: null }));
    render(
      <MemoryRouter>
        <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
          <PendingShareContext.Provider
            value={{
              clearPendingShare: vi.fn().mockResolvedValue(undefined),
              error: null,
              pendingShare: {
                id: 'share-1',
                kind: 'text',
                receivedAt: '2026-10-26T10:00:00.000Z',
                text: 'https://example.com/story',
                title: 'A story',
              },
            }}
          >
            <QuickCapturePage />
          </PendingShareContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Shared to Second Brain' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Nothing has been saved yet.');
    expect(screen.getByRole('button', { name: 'Save to inbox' })).toBeEnabled();
  });
});
