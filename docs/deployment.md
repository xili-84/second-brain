# Deployment to brain.okdaily.net

The web app is a static build. Its files sit **directly in the subdomain's document root**,
`/home/<cpanel-user>/brain.okdaily.net` (no `current`/`next` folders). Deploying never applies
Supabase migrations.

The same layout works on ALL-INKL (Apache with `mod_rewrite` and `mod_headers`). After moving
hosts, re-check the manifest MIME type, the security headers, the HTTPS redirect and the
certificate.

## Production origin

The PWA is hosted at the root of `https://brain.okdaily.net`, so its manifest uses `id: /`,
`start_url: /` and `scope: /`. The service worker is served as
`/sw.js` with root scope.

## Build

```bash
npm ci
npm run check        # Windows: npm.cmd ci / npm.cmd run check
```

The build needs `.env.local` (browser-safe values only) so the CSP in `dist/.htaccess` names the
Supabase project. Upload the **contents** of `dist/`, not the `dist` folder itself:

```text
.htaccess
index.html
manifest.webmanifest
sw.js
workbox-<hash>.js
assets/
icons/
```

Hashes change between builds; inspect `dist/` instead of copying names from an older release.

Never upload `.git/`, `.env`, `.env.local`, `src/`, `node_modules/`, `package*.json`, `supabase/`,
`docs/`, tests or development configuration.

`.htaccess` forces HTTPS, routes app URLs to `index.html`, disables directory listings, sets HSTS,
a strict Content-Security-Policy, `nosniff`, `Referrer-Policy` and `frame-ancestors 'none'`, marks
`index.html`, `sw.js` and the manifest `no-cache`, and marks content-hashed assets `immutable`.

## Option A: `scripts/deploy.sh` (SFTP or FTPS via lftp)

```bash
export DEPLOY_HOST=server.example.com DEPLOY_USER=cpaneluser DEPLOY_ROOT=brain.okdaily.net
export DEPLOY_PASSWORD='...'            # or use an SSH key with sftp
# export DEPLOY_PROTOCOL=ftps           # default: sftp
# export DEPLOY_BACKUP_ROOT=brain-backups

scripts/deploy.sh --dry-run             # show what would change; changes nothing
scripts/deploy.sh                       # back up, then upload new and changed files
scripts/deploy.sh --delete              # same, and also remove files the new build no longer has
```

Every real run first backs up the live document root:

- locally into `deploy-backups/<timestamp>/` (git-ignored), and
- on the server into `~/brain-backups/<timestamp>/`, outside the document root, so it is never
  publicly reachable (skip with `--no-remote-backup`).

Assets are uploaded before `index.html` and `sw.js`, so visitors never get an entry page that
points at missing files. Stale files are only removed with `--delete`. `.well-known/` (SSL
validation), `cgi-bin/`, `.user.ini`, `php.ini` and `error_log` are never deleted.

### Roll back

```bash
scripts/deploy.sh --rollback deploy-backups/<timestamp>
```

This backs up the current state again, then restores the chosen backup exactly (files that are
not in the backup are removed). Without the script, see the manual rollback below.

## Option B: cPanel File Manager

1. Build locally and zip the **contents** of `dist/` (on Windows: open `dist`, select all files
   including `.htaccess`, then _Send to → Compressed folder_).
2. In cPanel open **File Manager**, click **Settings** (top right) and tick **Show Hidden Files
   (dotfiles)**. Without this `.htaccess` is invisible.
3. Open `brain.okdaily.net`. Select everything except `.well-known` and `cgi-bin`, choose
   **Compress**, and save the archive one level up, outside the document root, for example
   `/home/<cpanel-user>/brain-backups/brain-<date>.zip`. This is your rollback copy.
4. Back in `brain.okdaily.net`, delete the old site files (`index.html`, `sw.js`,
   `workbox-*.js`, `manifest.webmanifest`, `.htaccess`, `assets/`, `icons/`). Leave `.well-known`
   and `cgi-bin` alone.
5. **Upload** the new zip into `brain.okdaily.net`, then right-click it → **Extract** into the same
   folder. Check that `index.html` and `.htaccess` sit directly in `brain.okdaily.net`, not in a
   subfolder, then delete the uploaded zip.
6. Open `.htaccess` (**View**) and confirm it contains the `Content-Security-Policy` line with your
   `https://<project>.supabase.co` origin and no `__SUPABASE_` placeholder.

### Manual rollback

Delete the new site files as in step 4, then extract the backup zip from `brain-backups/` back into
`brain.okdaily.net` and confirm `.htaccess` is present.

## Verify after every deploy

- `https://brain.okdaily.net` loads and sign-in works.
- `https://brain.okdaily.net/assets/` returns **403** (no directory listing).
- `/manifest.webmanifest` is served as `application/manifest+json`.
- `/sw.js` and `/` return `Cache-Control: no-cache`; `/assets/*.js` returns `immutable`.
- Response headers include `Strict-Transport-Security` and `Content-Security-Policy`.

From a terminal: `curl -sI https://brain.okdaily.net/ | grep -iE 'cache|security|strict'`.

Installed service workers cache the app shell; the app shows **Update now** when a new version is
ready. If testing still looks stale, close and reopen the installed PWA.

Delete old backups only after the new version is confirmed and a recovery copy exists.
