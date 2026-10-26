# Second Brain

Private, low-friction knowledge capture: **capture instantly, organize later.**

Notes, links and images go into an **Inbox**, are reviewed into **Reviewed** or **Archived**, and
can be deleted when done. One private account is shared by the web app (Windows and other browsers)
and the Android app.

| Part     | Technology                                                                                |
| -------- | ----------------------------------------------------------------------------------------- |
| Web app  | React 19, TypeScript, Vite 7, PWA (Workbox), React Router 7                               |
| Backend  | Supabase: email/password auth, Postgres with Row Level Security, private Storage bucket   |
| Android  | Capacitor 8 (`net.okdaily.brain`) with native share receiver and save-to-Pictures plugins |
| Hosting  | Static files on Apache/LiteSpeed shared hosting (Namecheap now, ALL-INKL from Nov 2026)   |
| Live URL | <https://brain.okdaily.net>                                                               |

There is no custom server. The browser talks to Supabase directly with the publishable key; RLS
and Storage policies make sure each user only ever sees their own rows and files.

## Requirements

- Node.js 22 or newer (`.nvmrc`); the Capacitor 8.5 CLI refuses older versions
- npm
- For Android: JDK 21 (Temurin) and Android SDK Platform 36 + Build Tools 36

## Configuration

Create `.env.local` (git-ignored) from `.env.example`:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only browser-safe values belong here. **Never** put a secret or service-role key in a `VITE_`
variable: everything prefixed `VITE_` is shipped to every visitor.

The build also writes the Supabase origin into the Content-Security-Policy in `dist/.htaccess`.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5173
npm run test:watch
npm run dev:mock     # http://localhost:5199 with fake data, no Supabase needed
```

`dev:mock` (`vite.mock.config.ts` + `dev/mock/`) swaps in an in-memory client with sample
captures, so screens can be designed and screenshotted offline. It is dev-server only and never
part of the production build. Add `?signedout`, `?empty`, `?slow` or `?slowdata` to a URL to see
the sign-in, empty and loading states.

## Check and build

```bash
npm run check        # prettier, eslint, tsc, vitest, production build into dist/
```

`npm run check` must stay green before every commit and deploy. CI
(`.github/workflows/ci.yml`) runs the same command plus an Android debug build.

## Deploy the web app

The production build is the contents of `dist/` (including the hidden `.htaccess`). The files go
**directly into the subdomain's document root**, `brain.okdaily.net`. It is static, so it runs
unchanged on Namecheap and on ALL-INKL. Full steps: [`docs/deployment.md`](docs/deployment.md).

### Option A: script (SFTP or FTPS via lftp)

```bash
export DEPLOY_HOST=server.example.com DEPLOY_USER=cpaneluser DEPLOY_ROOT=brain.okdaily.net
export DEPLOY_PASSWORD='...'          # or use an SSH key with sftp
# export DEPLOY_PROTOCOL=ftps         # default: sftp

scripts/deploy.sh --dry-run           # show what would change
scripts/deploy.sh                     # back up live files, upload new/changed files
scripts/deploy.sh --delete            # ...and remove stale files from older builds
scripts/deploy.sh --rollback deploy-backups/<timestamp>   # restore a backup exactly
```

Each run backs up the live site to `deploy-backups/<timestamp>/` locally and to
`~/brain-backups/<timestamp>/` on the server (outside the document root).

### Option B: cPanel File Manager

Show hidden files, compress the current site into a backup zip outside `brain.okdaily.net`, delete
the old site files (keep `.well-known` and `cgi-bin`), upload and extract the new zip directly in
`brain.okdaily.net`, then confirm `.htaccess` is there with the CSP line.

After a deploy, check `https://brain.okdaily.net`, `/manifest.webmanifest`
(`application/manifest+json`), `/sw.js` (`Cache-Control: no-cache`) and that `/assets/` returns 403.

## Android app

The Android project lives in [`android/`](android/README.md).

```bash
npm run android:check     # build web, cap sync, lint, assemble debug APK
npm run android:release   # signed release APK + AAB (needs the release key, see android/README.md)
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Database

Schema changes are versioned SQL files in `supabase/migrations/` and are applied with the Supabase
CLI (`supabase db push`) after review. Never edit an applied migration; add a new one.
`supabase/config.toml` mirrors production auth settings: sign-up disabled, minimum password
length 12.

Pending (written, not yet applied): `202610260001_search_captures.sql` (full-text search) and
`202610260002_search_tags_and_favorites.sql` (search also matches tags and returns tags and the
favorite flag). Apply both in one `supabase db push`. Until then the app falls back to substring
search, and tags, favorites and filters work regardless, because the `tags`, `capture_tags` and
`captures.is_favorite` schema has existed since the initial migration.

## Design system

The "Editorial" look: white paper and black ink (dark mode follows the system), one newsroom red
accent, Inter (bundled via `@fontsource-variable/inter`, so it works offline), heavy rules for
structure and hairlines between items, Lucide icons.

```text
src/styles/tokens.css      colours (light + dark), type scale, spacing, radii, safe-area insets
src/styles/base.css        reset, focus rings, .glass, reduced motion
src/styles/components.css  buttons, notices, chips, empty states, skeletons, wordmark
src/styles/shell.css       masthead, tab bar, top bar, sheets
src/styles/list.css        capture rows, day groups, search field and results
src/styles/article.css     capture detail and the pinned action bar
src/styles/forms.css       composer, kind switch, fields, image picker, sign-in
src/styles/tags.css        tag editor, tag lists, favorite star, filter row
```

Rules of thumb: use tokens, never raw colours; no inline `style` (the CSP is `style-src 'self'`);
no `color-mix()` or `:has()` (older Android WebViews), so state is expressed with classes; the
translucent `.glass` bars fall back to solid colour without `backdrop-filter`; every tap target is
at least 44 px (`--tap`).

## Brand assets

The icon is the wordmark reduced to its initial: a heavy Inter "S" and the red dot. All PWA icons
(any + maskable, favicon, apple-touch), Android launcher layers (adaptive foreground, background,
monochrome for themed icons, legacy PNGs) and the light/dark launch splash are generated from one
geometry:

```bash
python3 scripts/brand/build_brand_assets.py   # needs fonttools, brotli, Pillow and rsvg-convert
```

Sources land in `resources/brand/`. Splash colours live in `values/splash_colors.xml` and
`values-night/splash_colors.xml`.

## Project layout

```text
src/app/                 shell, routing, masthead, tab bar, PWA update prompt
src/components/          shared UI: Sheet, TopBar, ActionBar, Notice, EmptyState, Skeleton
src/features/auth/       session restore, sign-in, protected routes
src/features/capture/    quick capture, detail/edit, image upload, replacement, cleanup
src/features/inbox/      Inbox / Reviewed / Archived lists, thumbnails
src/features/search/     search field and results
src/features/tags/       tags, favorites and list filters
src/features/share-target/  Android share handoff (Capacitor plugin bridge)
src/lib/                 Supabase client, environment validation, generated DB types
src/styles/              design tokens and stylesheets (see Design system)
public/.htaccess         HTTPS, SPA routing, security headers, caching
android/                 Capacitor Android project
supabase/                config and migrations
scripts/                 deploy and cross-platform Gradle helpers
docs/                    architecture, deployment and milestone records
```

## Image safety model

Storage and Postgres do not share a transaction, so image work is idempotent and compensating
(see [`docs/architecture.md`](docs/architecture.md)). The background orphan cleanup
(`imageReconciliation.ts`) runs at most once a day, only touches objects older than one hour,
pages every listing with an exact count, skips the sweep whenever a listing is incomplete, and
re-checks every candidate against the database right before removal.
