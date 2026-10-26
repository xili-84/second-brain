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

const delay = <T>(value: T, isData = false) =>
  new Promise<T>((resolve) =>
    setTimeout(() => resolve(value), flags.slow || (isData && flags.slowData) ? 10_000_000 : 120),
  );

function pick(row: Row, columns: string) {
  if (!columns || columns.trim() === '*') return { ...row };
  const out: Row = {};
  for (const part of columns.split(/,(?![^(]*\))/)) {
    const key = (part.trim().split('(')[0] ?? '').trim();
    if (key) out[key] = row[key];
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
    if (this.table !== 'captures')
      return { data: null, error: { message: 'mock: unsupported table' } };
    const source = flags.empty ? [] : captures;
    if (this.mode === 'insert' && this.payload) {
      const row = { ...this.payload, created_at: new Date().toISOString(), attachments: [] };
      captures.unshift(row);
      return { data: pick(row, this.columns), error: null };
    }
    let rows = source.filter((r) => this.filters.every(([c, v]) => r[c] === v));
    if (this.mode === 'update' && this.payload) rows.forEach((r) => Object.assign(r, this.payload));
    if (this.mode === 'delete') rows.forEach((r) => captures.splice(captures.indexOf(r), 1));
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
          [row.title, row.content, row.source_url].some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(term),
          ),
        ),
      );
      return delay({ data: results.map((row) => pick(row, '*')), error: null }, true);
    },
    storage: {
      from: () => ({
        createSignedUrl: (path: string) =>
          delay({ data: { signedUrl: `/mock-images/${path.split('/').pop()}` }, error: null }),
        createSignedUrls: (paths: string[]) =>
          delay({
            data: paths.map((path) => ({
              path,
              signedUrl: `/mock-images/${path.split('/').pop()}`,
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
