import type { Session } from '@supabase/supabase-js';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SecondBrainClient } from '../../lib/supabase/client';
import { createTableClient, type FakeTables } from '../../test/fakeTables';
import { AuthContext } from '../auth/authContext';
import { InboxPage } from '../inbox/InboxPage';
import { LONG_PRESS_MS } from '../inbox/useRowGestures';
import { DeleteSnackbarHost } from './DeleteSnackbar';
import { PendingDeleteProvider, UNDO_WINDOW_MS } from './PendingDeleteProvider';

const USER = '8cfd9d8f-dde8-4ec3-b7d8-2fcb4241240d';
const session = { user: { id: USER } } as unknown as Session;

function seed(): FakeTables {
  const capture = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    attachments: [],
    content: null,
    created_at: '2026-10-26T09:00:00.000Z',
    id,
    is_favorite: false,
    kind: 'note',
    source_url: null,
    status: 'inbox',
    title,
    user_id: USER,
    ...extra,
  });
  return {
    capture_tags: [],
    captures: [
      capture('n1', 'Pitch deck'),
      capture('i1', 'Receipt', {
        attachments: [{ storage_path: `${USER}/i1/photo.jpg` }],
        kind: 'image',
      }),
      capture('n2', 'Grocery list'),
    ],
    tags: [],
  };
}

function renderInbox(client: SecondBrainClient) {
  return render(
    <MemoryRouter initialEntries={['/inbox']}>
      <AuthContext.Provider value={{ client, error: null, isRestoring: false, session }}>
        <PendingDeleteProvider>
          <InboxPage />
          <DeleteSnackbarHost />
        </PendingDeleteProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

async function ready() {
  expect(await screen.findByText('Grocery list')).toBeVisible();
  vi.useFakeTimers();
}

/** The layer of a row that follows the finger. */
function slideOf(title: string) {
  const link = screen.getByRole('link', { name: `Open ${title}` });
  const slide = link.closest('.row__slide');
  if (!(slide instanceof HTMLElement)) {
    throw new Error('no slide');
  }
  return slide;
}

function touch(target: HTMLElement, type: 'down' | 'move' | 'up', x: number, y: number) {
  const init = { clientX: x, clientY: y, isPrimary: true, pointerId: 7, pointerType: 'touch' };
  if (type === 'down') fireEvent.pointerDown(target, init);
  if (type === 'move') fireEvent.pointerMove(target, init);
  if (type === 'up') fireEvent.pointerUp(target, init);
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// jsdom has no PointerEvent; without it the coordinates of a touch would be dropped.
beforeAll(() => {
  if (!('PointerEvent' in window)) {
    class TestPointerEvent extends MouseEvent {
      readonly isPrimary: boolean;
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? true;
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('delete from the list with undo', () => {
  it('hides the row at once and deletes only after the undo window', async () => {
    const tables = seed();
    const { calls, client } = createTableClient(tables);
    renderInbox(client);
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Grocery list' }));
    await advance(200);

    expect(screen.queryByText('Grocery list')).not.toBeInTheDocument();
    const snackbar = screen.getByRole('status');
    expect(snackbar).toHaveTextContent('Item deleted');
    expect(within(snackbar).getByRole('button', { name: 'Undo' })).toBeVisible();
    expect(screen.getByText('2 items')).toBeVisible();

    await advance(UNDO_WINDOW_MS - 500);
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(0);

    await advance(600);
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(1);
    expect(tables.captures.map((row) => row.id)).toEqual(['n1', 'i1']);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('brings the row back on Undo and never deletes it', async () => {
    const tables = seed();
    const { calls, client } = createTableClient(tables);
    renderInbox(client);
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Pitch deck' }));
    await advance(200);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.getByText('Pitch deck')).toBeVisible();
    await advance(UNDO_WINDOW_MS * 2);
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(0);
    expect(tables.captures).toHaveLength(3);
  });

  it('deletes right away when the app goes to the background, storage first for images', async () => {
    const tables = seed();
    const { bucket, client } = createTableClient(tables);
    vi.mocked(client.rpc).mockResolvedValue({ data: true, error: null } as never);
    renderInbox(client);
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Receipt' }));
    await advance(200);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    visibility.mockRestore();

    expect(bucket.remove).toHaveBeenCalledWith([`${USER}/i1/photo.jpg`]);
    expect(client.rpc).toHaveBeenCalledWith('delete_image_capture_after_storage', {
      p_capture_id: 'i1',
    });
  });

  it('puts the row back and says so when the delete fails', async () => {
    const { client } = createTableClient(seed(), {}, ({ op }) =>
      op === 'delete' ? { message: 'offline' } : undefined,
    );
    renderInbox(client);
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Grocery list' }));
    await advance(200 + UNDO_WINDOW_MS);

    expect(screen.getByText('Grocery list')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      '“Grocery list” couldn’t be deleted and is back in the list.',
    );
  });

  it('removes a row with a full swipe to the left', async () => {
    const { calls, client } = createTableClient(seed());
    renderInbox(client);
    await ready();

    const slide = slideOf('Grocery list');
    touch(slide, 'down', 300, 100);
    touch(slide, 'move', 280, 101);
    touch(slide, 'move', 100, 104);
    expect(slide.style.transform).toContain('-200px');
    touch(slide, 'up', 100, 104);
    await advance(200);

    expect(screen.queryByText('Grocery list')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Item deleted');
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(0);
  });

  it('reveals the delete button on a short swipe and deletes on tap', async () => {
    const { client } = createTableClient(seed());
    renderInbox(client);
    await ready();

    const slide = slideOf('Pitch deck');
    touch(slide, 'down', 300, 100);
    touch(slide, 'move', 285, 100);
    touch(slide, 'move', 230, 100);
    touch(slide, 'up', 230, 100);
    expect(slide.style.transform).toContain('-88px');

    // The red area's button is hidden from screen readers (the row's own button is announced).
    const reveal = slide.parentElement?.querySelector('.row__swipe-button');
    expect(reveal).toBeInstanceOf(HTMLButtonElement);
    fireEvent.click(reveal as HTMLButtonElement);
    await advance(200);
    expect(screen.queryByText('Pitch deck')).not.toBeInTheDocument();
  });

  it('leaves vertical scrolling alone: no swipe and no long-press', async () => {
    const { client } = createTableClient(seed());
    renderInbox(client);
    await ready();

    const slide = slideOf('Grocery list');
    touch(slide, 'down', 200, 100);
    touch(slide, 'move', 190, 160);
    touch(slide, 'move', 120, 260);
    await advance(LONG_PRESS_MS + 100);
    touch(slide, 'up', 120, 260);

    expect(slide.style.transform).toBe('');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByText('Grocery list')).toBeVisible();
  });

  it('starts select mode with the row ticked on a long-press', async () => {
    const { client } = createTableClient(seed());
    renderInbox(client);
    await ready();

    touch(slideOf('Receipt'), 'down', 200, 100);
    await advance(LONG_PRESS_MS + 10);

    const bar = screen.getByRole('toolbar', { name: 'Selected captures' });
    expect(bar).toHaveTextContent('1 selected');
    expect(screen.getByRole('checkbox', { name: 'Select Receipt' })).toBeChecked();
    expect(screen.queryByRole('button', { name: /^Delete Receipt/u })).not.toBeInTheDocument();
  });

  it('does not open the Android link menu on a long-press', async () => {
    const { client } = createTableClient(seed());
    renderInbox(client);
    await ready();

    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    slideOf('Pitch deck').dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
});
