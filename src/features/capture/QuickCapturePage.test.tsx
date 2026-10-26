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
});
