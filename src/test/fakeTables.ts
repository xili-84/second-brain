import { vi } from 'vitest';

import type { SecondBrainClient } from '../lib/supabase/client';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

export type FakeTables = {
  capture_tags: Row[];
  captures: Row[];
  tags: Row[];
};

/**
 * A small in-memory stand-in for the Supabase query builder, enough for tags and favorites:
 * select (with `capture_tags(tags(id, name))` and `attachments(...)` embeds), eq, order, single,
 * insert, update and delete. `failures` makes the next matching call return an error.
 */
export function createTableClient(
  tables: FakeTables,
  failures: Partial<
    Record<`${keyof FakeTables}.${'delete' | 'insert' | 'update'}`, Result['error']>
  > = {},
  /** Fails single calls, e.g. deleting one particular capture. */
  failWhen?: (call: {
    filters: [string, unknown][];
    op: string;
    table: keyof FakeTables;
  }) => Result['error'] | undefined,
) {
  const calls: { op: string; payload?: unknown; table: string }[] = [];

  function embed(table: string, row: Row, columns: string) {
    const out: Row = {};
    for (const part of columns.split(/,(?![^(]*\))/u)) {
      const key = (part.trim().split('(')[0] ?? '').trim();
      if (key === 'capture_tags') {
        out[key] = tables.capture_tags
          .filter((link) => link.capture_id === row.id)
          .map((link) => {
            const tag = tables.tags.find((item) => item.id === link.tag_id);
            return { tags: tag ? { id: tag.id, name: tag.name } : null };
          });
      } else if (key === 'attachments') {
        out[key] = row.attachments ?? [];
      } else if (key) {
        out[key] = row[key];
      }
    }
    return table === 'captures' || table === 'tags' ? out : row;
  }

  function query(table: keyof FakeTables) {
    let op: 'delete' | 'insert' | 'select' | 'update' = 'select';
    let payload: Row = {};
    let columns = '*';
    let single = false;
    const filters: [string, unknown][] = [];

    function run(): Result {
      calls.push({ op, payload, table });
      const failure =
        (op !== 'select' ? failures[`${table}.${op}`] : undefined) ??
        failWhen?.({ filters, op, table });
      if (failure) {
        return { data: null, error: failure };
      }
      const rows = tables[table];
      if (op === 'insert') {
        if (
          table === 'tags' &&
          rows.some(
            (row) => String(row.name).toLowerCase() === String(payload.name).trim().toLowerCase(),
          )
        ) {
          return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        const row =
          table === 'tags' ? { id: `tag-${rows.length + 1}`, ...payload } : { ...payload };
        rows.push(row);
        return { data: single ? embed(table, row, columns) : [row], error: null };
      }
      const matched = rows.filter((row) =>
        filters.every(([column, value]) =>
          column === 'normalized_name'
            ? String(row.name).toLowerCase() === value
            : row[column] === value,
        ),
      );
      if (op === 'update') {
        matched.forEach((row) => Object.assign(row, payload));
      }
      if (op === 'delete') {
        matched.forEach((row) => rows.splice(rows.indexOf(row), 1));
      }
      const data = matched.map((row) => embed(table, row, columns));
      if (single) {
        return data[0]
          ? { data: data[0], error: null }
          : { data: null, error: { message: 'none' } };
      }
      return { data, error: null };
    }

    const builder = {
      delete() {
        op = 'delete';
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      insert(value: Row) {
        op = 'insert';
        payload = value;
        return builder;
      },
      order() {
        return builder;
      },
      select(value = '*') {
        columns = value;
        return builder;
      },
      single() {
        single = true;
        return builder;
      },
      then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
      update(value: Row) {
        op = 'update';
        payload = value;
        return builder;
      },
    };
    return builder;
  }

  const bucket = {
    createSignedUrl: vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://x.test/i' }, error: null }),
    createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const storageFrom = vi.fn(() => bucket);
  const client = {
    from: vi.fn((table: keyof FakeTables) => query(table)),
    rpc: vi.fn(),
    storage: { from: storageFrom },
  } as unknown as SecondBrainClient;

  return { bucket, calls, client, storageFrom };
}
