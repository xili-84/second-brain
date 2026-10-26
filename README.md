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
```

## Check and build

```bash
npm run check        # prettier, eslint, tsc, vitest, production build into dist/
```

`npm run check` must stay green before every commit and deploy. CI
(`.github/workflows/ci.yml`) runs the same command plus an Android debug build.

## Deploy the web app

The production build is the contents of `dist/` (including the hidden `.htaccess`). It is static,
so it runs unchanged on Namecheap and on ALL-INKL.

### Option A: script (SFTP or FTPS via lftp)

```bash
export DEPLOY_HOST=server.example.com DEPLOY_USER=cpaneluser DEPLOY_ROOT=brain.okdaily.net
export DEPLOY_PASSWORD='...'          # or use an SSH key with sftp
# export DEPLOY_PROTOCOL=ftps         # default: sftp

scripts/deploy.sh --dry-run           # show what would change
scripts/deploy.sh                     # upload into $DEPLOY_ROOT/next
scripts/deploy.sh --activate          # upload, then current -> previous-<ts>, next -> current
```

Roll back by renaming `previous-<ts>` back to `current`.

### Option B: cPanel File Manager

Zip the **contents** of `dist/`, upload into `brain.okdaily.net/next`, extract, check that
`.htaccess` and `index.html` sit directly in `next`, then swap folders as described in
[`docs/deployment.md`](docs/deployment.md).

After a deploy, check `https://brain.okdaily.net`, `/manifest.webmanifest`
(`application/manifest+json`), `/sw.js` (`Cache-Control: no-cache`) and that `/assets/` returns 403.

## Android app

The Android project lives in [`android/`](android/README.md).

```bash
npm run android:check     # build web, cap sync, lint, assemble debug APK
npm run android:release   # signed release APK + AAB (needs android/keystore.properties)
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Database

Schema changes are versioned SQL files in `supabase/migrations/` and are applied with the Supabase
CLI (`supabase db push`) after review. Never edit an applied migration; add a new one.
`supabase/config.toml` mirrors production auth settings: sign-up disabled, minimum password
length 12.

## Project layout

```text
src/app/                 shell, routing, PWA update prompt
src/features/auth/       session restore, sign-in, protected routes
src/features/capture/    quick capture, detail/edit, image upload, replacement, cleanup
src/features/inbox/      Inbox / Reviewed / Archived lists
src/features/share-target/  Android share handoff (Capacitor plugin bridge)
src/lib/                 Supabase client, environment validation, generated DB types
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
