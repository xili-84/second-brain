# Milestone 2: authenticated end-to-end capture

Status: complete and production-accepted on 2026-07-24. Automated web and Android checks pass.
Physical testing on the Huawei P40 Pro confirmed native plain-text sharing, editable review before
saving, authenticated Supabase persistence, and visibility of the saved capture in the Windows
inbox. The Namecheap build at `https://brain.okdaily.net` passed HTTPS, authentication, capture,
inbox, session-restoration, cross-device data, and retained diagnostic-route checks.

## Goal

Complete the smallest reliable loop: sign in on Android and Windows, explicitly save a shared note
or link, and see it in the Windows inbox. Images and organization features remain dormant.

## Tasks

1. Preserve the successful diagnostic source and APK. Move its source to an explicitly diagnostic
   location if Capacitor needs to own the repository's `android` directory.
2. Add only the dependencies required now: the Supabase JavaScript client, Capacitor core and
   Android tooling, and the pinned Supabase CLI development dependency.
3. Validate `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at startup and fail with a clear
   configuration message when either is missing or malformed.
4. Create one Supabase client and generate versioned TypeScript database types after the approved
   migration is applied.
5. Implement email/password sign-in, sign-out, session restoration, and authentication state
   handling. Do not add registration or passwordless authentication.
6. Protect the capture and inbox routes. Show a neutral loading state while the initial session is
   being restored; do not briefly expose protected content.
7. Build one quick-capture form supporting:
   - `note`: required non-empty title or body;
   - `link`: required valid HTTP or HTTPS URL and optional manual title;
   - an editable type and explicit **Save** and **Discard** actions.
8. Save only after **Save** is pressed. Create the capture with a client-generated UUID, the
   authenticated `user_id`, and status `inbox`. Disable duplicate submission while a request is in
   flight.
9. Display success only after Supabase confirms the inserted row. On failure, show an actionable
   error and retain the complete draft for retry.
10. Create the Capacitor Android package `net.okdaily.brain` with bundled Vite assets and a native
    `ACTION_SEND` receiver for `text/plain`.
11. Add a minimal Capacitor plugin that:
    - stores an incoming title/text payload in short-lived app-private storage;
    - returns a pending share on cold start;
    - emits a share event when the app is already running;
    - clears the payload only after confirmed save or explicit discard.
12. Prefill a link when the trimmed payload is one standalone HTTP or HTTPS URL. Otherwise prefill a
    note. Keep the form editable and never put private share content in a URL.
13. Build a simple protected Windows inbox showing the current user's `inbox` captures newest first,
    with kind, available title or content/URL, and creation time.
14. Add focused unit/component tests for environment validation, auth routing, share classification,
    form validation, duplicate-submit prevention, failure retention, and inbox rendering.
15. Run formatting, lint, strict type checking, tests, production web build, Android lint, and APK
    assembly. Perform the physical P40 Pro share test before retiring the diagnostic.

## Explicitly excluded

- Image upload or Android image sharing
- Tags
- Favorites
- Search
- Reviewed/archive workflows
- Editing or deleting captures
- Link metadata or previews
- Realtime subscriptions
- Pagination, offline capture, synchronization, collaboration, and administration
- Automated deployment or advanced monitoring

The existing database columns and tables for future features may remain unused; this milestone does
not expose them in the interface.

## Acceptance criteria

1. Public sign-up and anonymous sign-in are disabled, and the interface has no registration path.
2. An unauthenticated client cannot read captures.
3. The owner can sign in with email/password on Windows and in the Android APK.
4. Each client restores its own authenticated session after relaunch.
5. Protected routes reveal no protected content before session restoration completes.
6. Typing or receiving a note or link never creates a row before **Save** is pressed.
7. A confirmed save creates exactly one owned `captures` row with the expected kind, content,
   optional title, source URL, and `inbox` status.
8. A failed save never shows success and retains the full draft for retry.
9. Sharing ordinary text on the P40 Pro opens an editable note form without placing the text in a
   URL.
10. Sharing one standalone HTTP or HTTPS URL opens an editable link form.
11. Discarding or canceling an incoming share creates no database row.
12. A capture saved from Android appears in the Windows inbox after refresh.
13. The diagnostic bridge remains installable and unchanged until criteria 9 through 12 pass on the
    physical P40 Pro.
14. No excluded feature is exposed.
15. All repository and Android checks pass.

All acceptance criteria were confirmed on 2026-07-24. The diagnostic bridge remains preserved in
`android-diagnostic/` as a recoverable fallback, but it is no longer required by the production
capture path.

## Decisions recorded for approval

- Supabase region: Central EU (Frankfurt).
- Production Android package ID: `net.okdaily.brain`; diagnostic remains
  `net.okdaily.brain.bridge`.
- Android delivery: bundled Vite assets, not a remotely hosted primary interface.
- Native pending share: app-private and retained until confirmed save or explicit discard.
- Classification: one standalone HTTP/HTTPS URL is a link; everything else is a note.
- Password recovery UI: deferred for the private single-user milestone; account recovery is managed
  through the Supabase dashboard initially.
