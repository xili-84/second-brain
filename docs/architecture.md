# Second Brain architecture

## Product intent

Second Brain is a private, cross-platform knowledge capture system built around one principle:

> Capture instantly. Organize later.

Version 1 is a personal, online-only application. It accepts notes, copied text, links, and one
optional image, puts every new capture into an inbox, and supports later review from Windows.

## Approved system boundary

- A React, TypeScript, and Vite PWA runs on `https://brain.okdaily.net`.
- Namecheap shared hosting serves only the compiled static application.
- Supabase provides email/password authentication, PostgreSQL, and private image storage.
- Browser clients use only the Supabase project URL and publishable key.
- PostgreSQL Row Level Security and Storage policies enforce record ownership.
- Every user-owned database row includes `user_id`, while collaboration remains out of scope.
- A Capacitor Android application packages the React build and supplies a native `ACTION_SEND`
  receiver where browser-installed PWAs cannot register reliably with EMUI.
- Windows browsers and the Android application sign in separately to the same Supabase project and
  therefore see the same account-owned captures.

No public registration, custom API, separately implemented native interface, link scraping,
background processing, offline outbox, or client-side end-to-end encryption is included in
Version 1.

## Web and Android delivery

Namecheap hosts the compiled Vite application at `https://brain.okdaily.net` for Windows and
compatible mobile browsers. The production Capacitor APK uses the same React source but bundles its
compiled web assets inside the APK; it does not load the Namecheap site as its primary interface.
Both clients communicate directly with the same Supabase project over HTTPS using a browser-safe
publishable key.

Bundling is the approved Android approach because it gives reliable startup and a private
native-to-JavaScript handoff on the P40 Pro without depending on Huawei Browser, GBox, or the
hosting certificate chain. An Android interface update consequently requires a new APK build and
installation. Authentication sessions remain local to each client, so the user signs in once on
Windows and once in the Android app even though both sessions access the same data.

## Capture model

`captures` is the central record. Its kind is `note`, `link`, `image`, or `file`, and its lifecycle status is
`inbox`, `reviewed`, or `archived`. Tags use a normalized many-to-many relationship. Image bytes
live in a private Supabase Storage bucket, while attachment metadata lives in PostgreSQL.

The Version 1 interface permits one JPEG, PNG, or WebP image of at most 10 MiB per capture. SVG,
GIF, HEIC, and HEIF are rejected. The schema permits multiple attachments later without a
migration.

## Save integrity

The interface may report success only after Supabase confirms the write. A failed request must keep
the user's entered content available, show an explicit error, and offer retry. Version 1 requires an
internet connection and does not queue captures for later synchronization.

## Image creation, failure cleanup, and deletion

Supabase Storage and PostgreSQL do not share one ACID transaction. The application must therefore
use an idempotent, compensating workflow and reconciliation rather than imply that the two services
commit atomically.

### Creating an image capture

1. Validate the local file before any remote request: it must be a decodable JPEG, PNG, or WebP and
   no larger than 10 MiB. Keep the selected `File`, title, and note in the capture form while the
   operation runs.
2. Generate the capture ID and object ID once. Build a deterministic private path in the form
   `{user_id}/{capture_id}/{object_id}.{extension}`. Retries reuse these identifiers and uploads use
   `upsert: false`, preventing duplicate captures and accidental replacement.
3. Upload the image object first. No capture or attachment row exists yet, and the interface remains
   in a working state without displaying success.
4. After Storage confirms the upload, call a transaction-backed PostgreSQL function that will be
   added with the image feature. That function inserts the `captures` and `attachments` rows in one
   database transaction using the pre-generated IDs. A database failure rolls back both rows.
5. Report success and clear the local form only after both the Storage upload and database
   transaction are confirmed.

If the upload fails, no database record exists. If the database transaction fails after upload, the
application immediately deletes the uploaded object and confirms the deletion. The form data and
selected browser `File` remain available for retry while the page stays open. A lost response is
resolved idempotently by checking the pre-generated IDs instead of creating a second capture.

If connectivity or a process interruption prevents immediate object cleanup, the operation remains
failed—never successful—and the object becomes a cleanup obligation. On the next authenticated,
online application launch, reconciliation compares the current user's Storage paths with attachment
metadata. Objects older than a conservative safety window and not referenced by `attachments` are
deleted. Image captures older than the same window with no valid attachment are deleted; for a note
or link with an optional missing image, only stale attachment metadata is removed.

This provides eventual cleanup after connectivity returns. Literal instantaneous atomicity across
Storage and PostgreSQL is not available. The implementation must test every failure boundary before
image capture is released.

### Several images per capture

An image capture holds 1 to 10 images (for example a 9:16 story and a square feed post). No schema
or RPC change was needed: `attachments` already allows many rows per capture, and the owner-scoped
attachment and Storage policies cover the extra rows and objects.

- **Order.** Images display oldest `attachments.created_at` first (ID as tie-breaker); the first
  is the cover shown in lists with a "+N" badge. The client writes order as timestamps 1 ms apart.
- **Creating.** All images upload in parallel (three at a time, `upsert: false`, every path inside
  `{user_id}/{capture_id}/`). If any upload fails nothing is created; stored uploads are kept so a
  retry uploads only the failures (an "already exists" reply counts as stored), or the user removes
  them. Then `finalize_image_capture` creates the capture with the first image atomically, and the
  other rows are inserted with timestamps after the cover. If that insert cannot be confirmed the
  capture is still saved with its cover, the unattached objects are removed, and a warning says so.
- **Editing.** New images upload first; any failure removes them again and changes nothing. Then
  new rows are inserted, order timestamps updated, and removed rows deleted before their objects.
  A capture always keeps at least one image. Leftover objects are unreferenced and are swept by
  reconciliation.
- **Cleanup marker.** The local pending marker lists every path of an attempt
  (`additionalPaths`); reconciliation removes only the paths that no attachment references.

### File attachments

A `file` capture holds 1 to 10 files of any type, up to 50 MB each (the Supabase free-plan object
cap, checked in the app first so the message is friendly). It reuses the same `attachments` table,
the same private `capture-images` bucket and the same owner-folder policies as images; only the
limits change (`202611160001_file_attachments.sql`: bucket 50 MiB with no MIME allow-list,
attachments accept any MIME type up to 50 MiB, captures may be of kind `file`). Images keep their
10 MiB / JPEG-PNG-WebP rules, checked by the app and by `finalize_image_capture`.

- **Creating** (`fileCapture.ts`). Files upload three at a time to
  `{user_id}/{capture_id}/{attachment_id}.{ext}` (original extension if it is plain ASCII; the real
  name lives in `attachments.original_name`). Any failed upload creates nothing; a retry uploads
  only the failures. Then the capture row and the attachment rows are inserted with the user's own
  RLS rights (no RPC). If no row can be attached the capture is removed again; if only some are,
  the capture keeps those and the other objects are removed. The same pending-cleanup marker and
  reconciliation as images apply.
- **Editing.** The shared `applyImageEdits` runs in `file` mode (add, remove, reorder; at least one
  file stays).
- **Download and open.** Nothing is signed until the user taps. In a browser a 5-minute signed URL
  with `download=<name>` is followed. In the Android app `FileSaverPlugin` downloads that URL
  (HTTPS, `*.supabase.co` only) into the cache, checks the size, and publishes it to
  `Downloads/Second Brain` (MediaStore on Android 10+, a plain file with a one-time permission
  request on 9 and older). The saved copy can then be opened through an `ACTION_VIEW` intent with a
  read grant. APKs are left to the Files app so the app needs no install permission.
- **Deleting.** `deleteCapture` removes every object of the capture's folder first and only then the
  row (attachments cascade), so a file is never left without its record.
- **Search.** The database function is unchanged. The client also looks for the typed words in
  `attachments.original_name` (every word, case-insensitive) and adds those file captures after the
  text matches; if that lookup fails the text results are shown alone.
- **Android share.** `SEND` and `SEND_MULTIPLE` accept any MIME type. Items are copied to private
  storage (up to 10, 50 MiB each, content:// from other apps only) and handed to React in chunks.
  If every item is a JPEG/PNG/WebP the share is an image draft exactly as before; anything else
  (including GIF or HEIC) makes a file draft. A `.txt` shared from a file manager (a stream and no
  text) is a file; shared text and links stay notes and links.

### Deleting an image capture

Deletion is also an idempotent multi-step operation:

1. The application reads the owned attachment paths while their metadata still exists.
2. It removes every private object through the Supabase Storage API. Storage objects must never be
   deleted by manipulating `storage.objects` through SQL.
3. After Storage confirms removal, a transaction-backed database function verifies that the
   capture's deterministic Storage folder is empty and deletes the capture. Attachment and tag
   relationships are removed by foreign-key cascades.
4. The interface reports completion only after both Storage and database deletion are confirmed.
5. If Storage deletion fails, database records remain intact and the UI retries. If database
   deletion fails after Storage succeeds, the missing-object record remains visible as incomplete
   and the database deletion can be retried or reconciled.

This Storage-first order guarantees that deleting only database metadata cannot silently leave a
billed object behind. The application must not reset a failed creation form while its local draft
can still be retried.

## Android sharing

Huawei EMUI browsers do not register installed PWAs in the system Share menu, so Android sharing is
provided by the Capacitor app's native `ACTION_SEND` receiver (package `net.okdaily.brain`). The
earlier browser Share Target route and the separate diagnostic APK were retired on 2026-10-26 after
release 1.1.1 passed physical tests for text, Gallery and Files image sharing, and Save to phone.
`/share` now redirects to the home page.

For production text sharing:

1. The native receiver accepts `text/plain` and puts the title and text into short-lived,
   app-private pending storage.
2. A small Capacitor plugin exposes that pending payload to React on cold start and emits an event
   when a share arrives while the app is already running.
3. React restores authentication before presenting the protected capture form. A share received
   before sign-in remains pending through sign-in.
4. A standalone HTTP or HTTPS URL defaults to a link capture; other text defaults to a note. The
   user may edit the type, title, text, or URL.
5. No Supabase write occurs until the user explicitly presses **Save**. A confirmed save or an
   explicit discard clears the pending native value; a failed save leaves it available for retry.

The native payload must never be placed in a URL, browser history, or Namecheap access log. The
pending value is a local handoff buffer, not an offline synchronization outbox.

The production Capacitor path passed physical acceptance on the Huawei P40 Pro on 2026-07-24.
Shared plain text opened the authenticated React capture form, remained unsaved until explicit
confirmation, persisted successfully to Supabase, and appeared in the Windows inbox. This confirms
that Android and Windows use the same account-owned dataset.

The corresponding Namecheap web build passed production acceptance at
`https://brain.okdaily.net` on the same date, including HTTPS, authentication, note/link capture,
inbox retrieval, session restoration, and cross-device visibility.

## Post-Version-1 Android image extensions

Milestone 4B extends the private handoff to JPEG, PNG, and WebP `ACTION_SEND` image shares, and
`ACTION_SEND_MULTIPLE` (up to 10 images, each checked on its own; skipped items are reported) turns
several shared images into one draft.
Android copies the temporary content URI immediately into app-private storage, enforces the 10 MiB
limit, and exposes the copy to React in bounded chunks. React applies the existing image validation
and upload workflow. The pending native image is cleared only after a confirmed save or explicit
discard.

Milestone 4C lets the authenticated user save a displayed private image to the phone. The native
plugin downloads the short-lived signed URL into a private temporary file, verifies the expected
size and limit, and publishes the completed image to `Pictures/Second Brain`. Android 10 and newer
use MediaStore; Android 9 and older request legacy write access only after the user initiates the
save.

Both extensions pass repository checks, Android lint, and debug APK assembly. Physical Huawei P40
Pro acceptance remains pending, so neither extension is recorded as accepted yet. See
[milestone-4b.md](milestone-4b.md) and [milestone-4c.md](milestone-4c.md).

## Final migration review

The initial migration remains approved for controlled one-time application to a new Supabase
project. It provides owner-scoped `captures`, `attachments`, `tags`, and `capture_tags` tables;
composite ownership foreign keys; validation constraints; useful future indexes; an `updated_at`
trigger; Row Level Security policies for authenticated owners; revoked anonymous table access; and
a private `capture-images` bucket.

The bucket statement safely updates an existing bucket with the same ID and preserves private
status, the 10 MiB limit, and the JPEG, PNG, and WebP allowlist. Storage policies restrict object
paths to the signed-in user's UUID. The rest of the migration is intentionally not globally
idempotent and must be applied once through versioned migration history, not repeatedly through the
SQL Editor.

The schema includes image, tag, favorite, archive, and search foundations, but the next milestone
will leave the unused organization features dormant. HTTP/HTTPS URL validation remains an
application responsibility. The approved `202607240002_image_capture_functions.sql` migration was
applied on 2026-07-24 and adds authenticated, RLS-respecting transaction boundaries for finalizing
image metadata and deleting image records only after Storage removal.

## Search

The search box on the Inbox, Reviewed and Archived pages searches every capture the signed-in user
owns, whatever its status. Typing is debounced (250 ms) and the committed query lives in `?q=`.
Keyboard: `/` focuses the box, Escape clears it, the arrow keys move between the box and results.
Matches are highlighted with `<mark>` text nodes (never HTML); image notes stay hidden in results.

`202610260001_search_captures.sql` adds `public.search_captures(p_query, p_limit)`, a
security-invoker function that reuses the `captures_search_idx` GIN expression with prefix terms,
returns at most 100 rows, and only reads the caller's own rows. **It is not applied yet**: apply it
with `supabase db push` after review. Until then the client detects the missing function and falls
back to an escaped all-terms `ilike` search over title, content and link (slower, substring only).

## Delivery constraints

Database migrations remain versioned and reviewable. The approved initial migration was applied to
the remote Supabase project on 2026-07-24 and verified for RLS, anonymous denial, ownership
policies, and private bucket configuration. Every future schema change requires a new reviewed
migration. Initial deployment is manual. GitHub Actions, remote repository configuration,
Docker-based local Supabase, Playwright, advanced monitoring, and automated deployment are
intentionally deferred.

The deployment procedure is recorded in [deployment.md](deployment.md).
