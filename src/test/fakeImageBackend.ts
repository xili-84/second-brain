import { vi } from 'vitest';

import type { SecondBrainClient } from '../lib/supabase/client';

export type FakeAttachment = {
  capture_id: string;
  id: string;
  storage_path: string;
  user_id: string;
};

export type FakeObject = { created_at: string; path: string };

type Filter = (row: FakeAttachment) => boolean;

type FakeBackendOptions = {
  attachmentError?: boolean;
  /** Simulates a server max_rows lower than the requested page size. */
  maxRows?: number;
  verifyError?: boolean;
};

/**
 * An in-memory Supabase stand-in covering the attachment queries and Storage list/remove calls
 * used by image reconciliation. PostgREST semantics such as max_rows truncation are modelled.
 */
export function createFakeImageBackend(
  initialAttachments: FakeAttachment[],
  initialObjects: FakeObject[],
  options: FakeBackendOptions = {},
) {
  const attachments = [...initialAttachments];
  const objects = new Map(initialObjects.map((object) => [object.path, object]));
  const removedPaths: string[] = [];

  function query() {
    const filters: Filter[] = [];
    let rangeFrom = 0;
    let rangeTo = Number.POSITIVE_INFINITY;
    let wantsCount = false;
    let usesIn = false;
    let single = false;

    const builder = {
      eq(column: keyof FakeAttachment, value: string) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in(column: keyof FakeAttachment, values: string[]) {
        usesIn = true;
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      maybeSingle() {
        single = true;
        return builder;
      },
      order() {
        return builder;
      },
      range(from: number, to: number) {
        rangeFrom = from;
        rangeTo = to;
        return builder;
      },
      select(_columns: string, selectOptions?: { count?: string }) {
        wantsCount = selectOptions?.count === 'exact';
        return builder;
      },
      then(resolve: (value: unknown) => void) {
        if (options.attachmentError || (usesIn && options.verifyError)) {
          resolve({ count: null, data: null, error: new Error('unavailable') });
          return;
        }

        const matching = attachments
          .filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => a.id.localeCompare(b.id));

        if (single) {
          resolve({ data: matching[0] ?? null, error: null });
          return;
        }

        const limit = Math.min(rangeTo - rangeFrom + 1, options.maxRows ?? Infinity);
        resolve({
          count: wantsCount ? matching.length : null,
          data: matching.slice(rangeFrom, rangeFrom + limit),
          error: null,
        });
      },
    };

    return builder;
  }

  function list(prefix: string, listOptions: { limit: number; offset: number }) {
    const entries = new Map<
      string,
      { created_at: string | null; id: string | null; name: string }
    >();

    for (const object of [...objects.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      if (!object.path.startsWith(`${prefix}/`)) {
        continue;
      }

      const rest = object.path.slice(prefix.length + 1);
      const name = rest.split('/')[0] ?? '';
      const isFolder = rest.includes('/');

      if (isFolder) {
        entries.set(name, { created_at: null, id: null, name });
      } else {
        entries.set(name, { created_at: object.created_at, id: `object-${object.path}`, name });
      }
    }

    const data = [...entries.values()].slice(
      listOptions.offset,
      listOptions.offset + listOptions.limit,
    );
    return Promise.resolve({ data, error: null });
  }

  const remove = vi.fn((paths: string[]) => {
    for (const path of paths) {
      objects.delete(path);
      removedPaths.push(path);
    }

    return Promise.resolve({ data: [], error: null });
  });

  const client = {
    from: vi.fn(() => query()),
    storage: {
      from: vi.fn(() => ({ list: vi.fn(list), remove })),
    },
  } as unknown as SecondBrainClient;

  return { attachments, client, objects, remove, removedPaths };
}
