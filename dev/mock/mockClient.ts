/* Dev-only fake Supabase client for design review screenshots. Never imported by the real app. */
import type { SecondBrainClient } from '../../src/lib/supabase/client';

type Row = Record<string, unknown>;
const USER_ID = '00000000-0000-4000-8000-000000000001';
const params = new URLSearchParams(window.location.search);
const flags = {
  empty: params.has('empty') || localStorage.getItem('mock-empty') === '1',
  signedOut: params.has('signedout') || localStorage.getItem('mock-signedout') === '1',
  slowData: params.has('slowdata'),
  slow: params.has('slow') || localStorage.getItem('mock-slow') === '1',
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
let n = 0;
const id = () => `c0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const captures: Row[] = [
  {
    id: id(),
    kind: 'link',
    status: 'inbox',
    title: 'EU AI Act: what changes for publishers in 2027',
    source_url: 'https://www.politico.eu/article/eu-ai-act-publishers-2027-guide/',
    content: null,
    created_at: hoursAgo(0.4),
  },
  {
    id: id(),
    kind: 'note',
    status: 'inbox',
    title: 'Article idea: why small newsrooms should own their audience',
    content:
      'Hook: every platform change wipes out 30% of referral traffic.\n\nAngle — newsletters + PWA + push. Interview 2–3 local editors. Compare okdaily numbers before/after the Facebook drop.\n\nNeed: data from Reuters Digital News Report 2026, quote from a small publisher, one chart.',
    source_url: null,
    created_at: hoursAgo(2),
  },
  {
    id: id(),
    kind: 'image',
    status: 'inbox',
    title: 'Headline style from the Guardian app',
    content:
      'Love the tight bold headline + thin rule under the section label. Steal for okdaily article pages.',
    source_url: null,
    created_at: hoursAgo(5),
    img: 'screenshot.png',
    size: 35684,
    mime: 'image/png',
  },
  {
    id: id(),
    kind: 'link',
    status: 'inbox',
    title: null,
    source_url: 'https://developer.android.com/develop/ui/views/launch/splash-screen',
    content: null,
    created_at: hoursAgo(9),
  },
  {
    id: id(),
    kind: 'note',
    status: 'inbox',
    title: null,
    content:
      'Call the hosting provider about moving brain.okdaily.net to ALL-INKL before 15 Nov. Ask about SSL + .htaccess support.',
    source_url: null,
    created_at: hoursAgo(26),
  },
  {
    id: id(),
    kind: 'image',
    status: 'inbox',
    title: 'Sunset, Durrës beach',
    content: null,
    source_url: null,
    created_at: hoursAgo(30),
    img: 'sunset.jpg',
    size: 87463,
    mime: 'image/jpeg',
  },
  {
    id: id(),
    kind: 'link',
    status: 'inbox',
    title: 'How The Verge redesigned its homepage',
    source_url: 'https://www.theverge.com/2022/9/13/23351042/verge-redesign-feed-homepage',
    content: null,
    created_at: hoursAgo(50),
  },
  {
    id: id(),
    kind: 'note',
    status: 'inbox',
    title: 'Reel script — 3 tools I use every day',
    content: '1. Second Brain for capture\n2. Notion for planning\n3. CapCut for edits',
    source_url: null,
    created_at: hoursAgo(75),
  },
  {
    id: id(),
    kind: 'image',
    status: 'reviewed',
    title: 'Q4 content plan whiteboard',
    content: 'Photo from Thursday planning. Six pillars, one per weekday + weekend roundup.',
    source_url: null,
    created_at: hoursAgo(120),
    img: 'whiteboard.jpg',
    size: 37942,
    mime: 'image/jpeg',
  },
  {
    id: id(),
    kind: 'link',
    status: 'reviewed',
    title: 'Inter typeface — font specimen',
    source_url: 'https://rsms.me/inter/',
    content: null,
    created_at: hoursAgo(160),
  },
  {
    id: id(),
    kind: 'note',
    status: 'reviewed',
    title: 'Interview questions for Arben',
    content:
      '- How did you grow to 40k newsletter subscribers?\n- What failed?\n- What would you do with zero budget?',
    source_url: null,
    created_at: hoursAgo(200),
  },
  {
    id: id(),
    kind: 'note',
    status: 'archived',
    title: 'Old domain renewal reminder',
    content: 'Renewed for 2 years. Done.',
    source_url: null,
    created_at: hoursAgo(900),
  },
  {
    id: id(),
    kind: 'link',
    status: 'archived',
    title: 'Capacitor 7 migration guide',
    source_url: 'https://capacitorjs.com/docs/updating/7-0',
    content: null,
    created_at: hoursAgo(1200),
  },
];
for (const c of captures) {
  c.user_id = USER_ID;
  c.updated_at = c.created_at;
  c.archived_at = null;
  c.attachments = c.img
    ? [
        {
          id: `a-${String(c.id)}`,
          storage_path: `${USER_ID}/${String(c.id)}/${String(c.img)}`,
          original_name:
            c.img === 'screenshot.png' ? 'Screenshot_20261026_083012.png' : String(c.img),
          mime_type: c.mime,
          size_bytes: c.size,
        },
      ]
    : [];
}

// Link previews, as the link-preview Edge Function would store them.
const FAVICONS = {
  politico:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABKUlEQVR4nGM8IaD3n2EAAdNAWj7qgFEHjDqAgYGBgYVYhWZvzjMwMmN3778fPxl+v37H8PXCNYa3q7cyvNu8l2gHMBJbEOFzADr4sOcIw+3YIoZ/P34SVEt2FFwyC2A4KajPcFrClOF6QBrDr2cv4XICLjYMci3FRJlDcRr49/MXw6eDJxke1faiiItGBzAwcbDT3gEw8PnEBVSDOdgZ2BVl6ecABkZGTLH/hJMX1RzAa26Awv/34yfDzwdPCOojOhviAkzsbAw8FoYMcs1FKOKvl24gKheQ7QC9Uxtwyn3Ye5ThUW0fUeZQHAIMDJCc8Of1W4avF64zvFm9leHdpj1E6yXbAZfMAhi+375PrnY4GPC6YNQBow4gujqmFRjwEBh1wKgDRh0AAAB7WNUuSXGoAAAAAElFTkSuQmCC',
  android:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABqElEQVR4nO2Wv0/CQBTHv/UHmEAAJSSQCIkmKKziygpODjq5GRMn/w3/C6O7g4NRdFDRuDkQTVQMhUVBiXGgFFqlhdYBc1BsaBtKWHpL37v33r1Pvu1dj4oXdmWMcIyNsrkFYAFYAAAwYbRAKDKg1/b/zYcPN2Gf9xoGMKxAJfVsaN5cABlgzrKqIeb8BbJk/FA1BMBlihDLLPEp2zixm191cHevwwXoldm/E+8bNxVA+hbBpmniT/pd8G7EYAt6yFztpoBWvTEcADadh8SLxHcnFgEKcCciHchGE+wlrVY+OECvvJ6VaPuZjPTNMwVA/KyByxSJb5+bwVTY92d7iQ0A/MM7hBJjLgCTygJdW8yTjCri3a+B5OsclJ4bUX79AI23iu5FbQEXFo63AUo7V1MB/vHDUHMAEMosuPuSrlzNfwFzqvyowkdbsIemVZvSq3uKOsfSrCZAXwVkoYXqRa5D63OqNgfastsCLuJXr3KQfkTVXN0A7G0BrVrnYHHGgn0XcyyHiC3xItjrwmAAvfI7NAGUcebkSRNA1y4Y5hj5jcgCsAAsgF+8X5eXdG7RagAAAABJRU5ErkJggg==',
  verge:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB20lEQVR4nO2XTUsCURSG39GUshCzb4U+qBCKyMgQNKKCNhFl65D2rfsDQYuW/YJ2LbMWYUW7VBCtVoFFiyIc02oqikbTRltIt2a0aUzDRXM2w3vOuXeeOXPPnTvUXIc7gzKaopw3lwFkABkAACrEgotrFphHG4heXw5hZ+3y2/wJZxvml3qIPvExWHEGRAFEK+DZoHnaPmsUnczuMAjGh0XzfwQ43o+BfUoR3d6rhbG7Jm9uU6sGXQM6ohMsh+BerDiAVDIN/3aU5xM+JfHP8v0B9zWSca44AADwuPhltE0bQFG5ebYZYfnp3KTfAJwfPyJ68UJ0vbEKpiE9L6fTrENzezXRt+E4TgP3pQEAAI9LsBgFr2FYoL0uGhmJ31hJAN7NCG9C62QzVOrsUKWSgnWqJQdAqkkCYCJxhPwM0RqtCuax7P7QN1IPrV5NYmeHD4hdsaUFAIAD4Z7gMPKuHyZ18RUMENyNIsF+tpV5vAF1hioMTjQSXzLBIeC+/huAV5ZDcOdzT6hQKbCw2g91pZL4jvZvwD6//Q0AkNsNJkstPy5h6y0KIORncEfH88YeYq848TF5YyUDyGSyLZnPfFs00lzhB+yCzwPflbmQ3v9qlPxfIAPIAP8e4B2BwphCGhmLLQAAAABJRU5ErkJggg==',
  rsms: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAASElEQVR4nO3XsQ0AIAwDwYQNMkT2HyySV4COBUCk4C259rX2iJjWmNE5DgAAgCNAVZmk3cx8C7gVAAAAAAAAAIDzCwAA+B6wAP3mDjE+0/ylAAAAAElFTkSuQmCC',
};
const previews: Record<number, Row> = {
  1: {
    link_title: 'EU AI Act: what changes for publishers in 2027',
    link_description:
      'From training-data disclosures to labelling rules, a guide to the obligations that land on newsrooms and what to prepare now.',
    link_site_name: 'POLITICO',
    link_favicon: FAVICONS.politico,
  },
  4: {
    link_title: 'Splash screens',
    link_description:
      'Starting in Android 12, the SplashScreen API lets apps launch with animation, including an into-app motion at launch.',
    link_site_name: 'Android Developers',
    link_favicon: FAVICONS.android,
  },
  7: {
    link_title: 'The Verge has a new look',
    link_description: 'Introducing a homepage built around a feed of everything we do.',
    link_site_name: 'The Verge',
    link_favicon: FAVICONS.verge,
  },
  10: {
    link_title: 'Inter font family',
    link_description: 'Inter is a typeface carefully crafted & designed for computer screens.',
    link_site_name: null,
    link_favicon: FAVICONS.rsms,
  },
};
for (const [index, preview] of Object.entries(previews)) {
  const capture = captures.find(
    (c) => c.id === `c0000000-0000-4000-8000-${index.padStart(12, '0')}`,
  );
  if (capture) {
    Object.assign(capture, preview, {
      link_image_path: `${USER_ID}/${String(capture.id)}/preview`,
      link_preview_status: 'ready',
    });
  }
}

// Tags and favorites.
const tags: Row[] = ['okdaily', 'Ideas', 'Design', 'Admin', 'Reels'].map((name, index) => ({
  id: `t0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name,
  user_id: USER_ID,
}));
const tagId = (name: string) => String(tags.find((tag) => tag.name === name)?.id);
const captureTags: Row[] = [];
const seedTags: Record<number, string[]> = {
  1: ['okdaily'],
  2: ['Ideas', 'okdaily'],
  3: ['Design', 'okdaily'],
  4: ['Design'],
  5: ['Admin'],
  7: ['Design'],
  8: ['Reels', 'Ideas'],
  9: ['okdaily'],
};
captures.forEach((capture, index) => {
  capture.is_favorite = [2, 3, 10].includes(index + 1);
  for (const name of seedTags[index + 1] ?? []) {
    captureTags.push({ capture_id: capture.id, tag_id: tagId(name), user_id: USER_ID });
  }
});
const tagsOf = (captureId: unknown) =>
  captureTags
    .filter((link) => link.capture_id === captureId)
    .map((link) => tags.find((tag) => tag.id === link.tag_id))
    .filter(Boolean) as Row[];

/** Link previews live at <user>/<capture>/preview; their mock files are named after the capture. */
const mockImageUrl = (bucket: string, path: string) =>
  bucket === 'link-previews'
    ? `/mock-images/link-${path.split('/')[1]}.jpg`
    : `/mock-images/${path.split('/').pop()}`;

const delay = <T>(value: T, isData = false) =>
  new Promise<T>((resolve) =>
    setTimeout(() => resolve(value), flags.slow || (isData && flags.slowData) ? 10_000_000 : 120),
  );

function pick(row: Row, columns: string) {
  if (!columns || columns.trim() === '*') return { ...row };
  const out: Row = {};
  for (const part of columns.split(/,(?![^(]*\))/)) {
    const key = (part.trim().split('(')[0] ?? '').trim();
    if (key === 'capture_tags') {
      out[key] = tagsOf(row.id).map((tag) => ({ tags: { id: tag.id, name: tag.name } }));
    } else if (key) out[key] = row[key];
  }
  return out;
}

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private filters: [string, unknown][] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private columns = '*';
  private mode: 'select' | 'update' | 'insert' | 'delete' = 'select';
  private payload: Row | null = null;
  private isSingle = false;
  constructor(private table: string) {}
  select(cols = '*') {
    this.columns = cols;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push([col, v]);
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orderBy = { col, asc: o?.ascending ?? true };
    return this;
  }
  range() {
    return this;
  }
  limit() {
    return this;
  }
  in() {
    return this;
  }
  is() {
    return this;
  }
  single() {
    this.isSingle = true;
    return this;
  }
  maybeSingle() {
    this.isSingle = true;
    return this;
  }
  update(p: Row) {
    this.mode = 'update';
    this.payload = p;
    return this;
  }
  insert(p: Row) {
    this.mode = 'insert';
    this.payload = p;
    return this;
  }
  delete() {
    this.mode = 'delete';
    return this;
  }
  private run() {
    const table =
      this.table === 'captures'
        ? captures
        : this.table === 'tags'
          ? tags
          : this.table === 'capture_tags'
            ? captureTags
            : null;
    if (!table) return { data: null, error: { message: 'mock: unsupported table' } };
    const source = flags.empty ? [] : table;
    if (this.mode === 'insert' && this.payload) {
      const row: Row =
        this.table === 'tags'
          ? { ...this.payload, id: `t-${Date.now()}` }
          : this.table === 'capture_tags'
            ? { ...this.payload }
            : { ...this.payload, created_at: new Date().toISOString(), attachments: [] };
      table.unshift(row);
      return {
        data: this.isSingle ? pick(row, this.columns) : [pick(row, this.columns)],
        error: null,
      };
    }
    let rows = source.filter((r) =>
      this.filters.every(([c, v]) =>
        c === 'normalized_name' ? String(r.name).toLowerCase() === v : r[c] === v,
      ),
    );
    if (this.mode === 'update' && this.payload) rows.forEach((r) => Object.assign(r, this.payload));
    if (this.mode === 'delete') rows.forEach((r) => table.splice(table.indexOf(r), 1));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    const data = rows.map((r) => pick(r, this.columns));
    if (this.isSingle)
      return data[0]
        ? { data: data[0], error: null }
        : { data: null, error: { message: 'not found' } };
    return { data, error: null, count: data.length };
  }
  then<A, B>(
    ok?: (v: { data: unknown; error: unknown }) => A | PromiseLike<A>,
    bad?: (e: unknown) => B | PromiseLike<B>,
  ) {
    return delay(this.run(), true).then(ok, bad);
  }
}

const session = {
  access_token: 'mock',
  refresh_token: 'mock',
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: USER_ID,
    email: 'awa@okdaily.net',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: hoursAgo(5000),
  },
};

export function createMockClient(): SecondBrainClient {
  let current: typeof session | null = flags.signedOut ? null : session;
  const listeners = new Set<(e: string, s: unknown) => void>();
  return {
    auth: {
      getSession: () => delay({ data: { session: current }, error: null }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      signInWithPassword: async () => {
        current = session;
        listeners.forEach((l) => l('SIGNED_IN', current));
        return { data: { session }, error: null };
      },
      signOut: async () => {
        current = null;
        listeners.forEach((l) => l('SIGNED_OUT', null));
        return { error: null };
      },
    },
    from: (table: string) => new Query(table),
    rpc: (name: string, args: { p_query?: string } = {}) => {
      if (name !== 'search_captures') {
        return delay({ data: true, error: null });
      }
      const terms = (args.p_query ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
      const results = captures.filter((row) =>
        terms.every((term) =>
          [row.title, row.content, row.source_url, ...tagsOf(row.id).map((tag) => tag.name)].some(
            (value) =>
              String(value ?? '')
                .toLowerCase()
                .includes(term),
          ),
        ),
      );
      return delay(
        {
          data: results.map((row) => ({
            ...pick(row, '*'),
            tags: tagsOf(row.id).map((tag) => String(tag.name)),
          })),
          error: null,
        },
        true,
      );
    },
    functions: {
      invoke: (_name: string, options: { body?: { captureId?: string } } = {}) => {
        const capture = captures.find((c) => c.id === options.body?.captureId);
        return capture?.link_image_path
          ? delay({ data: { preview: capture }, error: null })
          : delay({ data: null, error: { context: { status: 422 }, message: 'mock: no preview' } });
      },
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string) =>
          delay({ data: { signedUrl: mockImageUrl(bucket, path) }, error: null }),
        createSignedUrls: (paths: string[]) =>
          delay({
            data: paths.map((path) => ({
              path,
              signedUrl: mockImageUrl(bucket, path),
              error: null,
            })),
            error: null,
          }),
        list: () => delay({ data: null, error: { message: 'mock: storage listing disabled' } }),
        remove: () => delay({ data: [], error: null }),
        upload: () => delay({ data: {}, error: null }),
      }),
    },
  } as unknown as SecondBrainClient;
}
