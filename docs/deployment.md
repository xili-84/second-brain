# Deployment to brain.okdaily.net

This procedure deploys the static web build. It does not apply Supabase migrations. The build
needs `.env.local` (browser-safe values only) so the CSP in `dist/.htaccess` names the Supabase
project. `scripts/deploy.sh` automates the upload and folder swap below over SFTP or FTPS; see the
README.

The same layout works on ALL-INKL (Apache with `mod_rewrite` and `mod_headers`). After moving
hosts, re-check the manifest MIME type, the security headers, the HTTPS redirect and the
certificate.

## Production origin

The PWA is hosted at the root of `https://brain.okdaily.net`, not in a subdirectory. Its manifest
therefore intentionally uses:

- `id: /`
- `start_url: /`
- `scope: /`
- Share Target action: `/share`

The generated service worker is served as `/sw.js`, giving it the same root scope.
The included `.htaccess` maps `.webmanifest` files to `application/manifest+json`; verify this
response header after every deployment because an incorrect generic binary type can prevent reliable
manifest processing.

## Recommended cPanel document root

In cPanel, create `brain.okdaily.net` with a dedicated document root and do not share the main
domain's document root. Use:

```text
/home/<cpanel-user>/brain.okdaily.net/current
```

The cPanel form may show the relative form `brain.okdaily.net/current`. Confirm the resolved path in
the Domains list after creation. Keeping this outside the main domain's `public_html` prevents a
diagnostic upload from replacing the main website.

Use sibling directories for later replacements:

```text
/home/<cpanel-user>/brain.okdaily.net/current
/home/<cpanel-user>/brain.okdaily.net/next
/home/<cpanel-user>/brain.okdaily.net/previous-<timestamp>
```

## Build

From the repository root on Windows:

```powershell
npm.cmd ci
npm.cmd run check

# or on macOS/Linux
npm ci && npm run check
```

The final check creates `dist/`. Upload the contents of `dist/`, not the `dist` directory itself.
The document root must contain `index.html` directly.

Expected top-level deployment files are:

```text
.htaccess
index.html
manifest.webmanifest
sw.js
workbox-<generated-hash>.js
assets/
icons/
```

`.htaccess` sets HSTS, a strict Content-Security-Policy, `nosniff`, `Referrer-Policy`,
`frame-ancestors 'none'`, disables directory listings, marks `index.html`, `sw.js` and the
manifest `no-cache`, and marks content-hashed assets `immutable`.

Generated hashes may change between builds. Inspect `dist/` rather than copying names from an older
release.

Never upload `.git/`, `.env`, `.env.local`, source files, `node_modules/`, `package.json`,
`package-lock.json`, `src/`, `supabase/`, `docs/`, tests, or development configuration. Only
`dist/` contents are public.

## Safe replacement

1. Build and check locally.
2. Upload the new `dist/` contents into the non-public sibling directory named `next`. If using a
   ZIP archive, confirm that it contains `.htaccess`, then extract it so `index.html` is directly in
   `next`.
3. Inspect `next` in File Manager. It should contain only the expected deployment files and folders.
4. Rename `current` to `previous-<timestamp>`.
5. Immediately rename `next` to `current`.
6. Test the home page, manifest, service worker, and `/share` diagnostic over HTTPS.
7. Keep the previous directory outside the active document root until the new diagnostic is
   verified. To roll back, rename `current` to a failed-release name and rename the previous
   directory back to `current`.
8. Remove old releases only after the new version is confirmed and a recovery copy exists.

Because installed service workers cache the shell, close and reopen the installed PWA after a
replacement. If testing appears stale, verify the build version in the browser and unregister the
old service worker only as a last resort.
