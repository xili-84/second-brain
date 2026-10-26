# Milestone 4A: image capture

Status: accepted on Windows and the Huawei P40 Pro on 2026-07-24.

## Goal

Allow the authenticated user to select one image inside Second Brain on Windows or Android, review
it, and save it as a private inbox capture without weakening the application's failure guarantees.

## Included

- Select one JPEG, PNG, or WebP from the capture form
- Reject files larger than 10 MiB
- Verify that the selected file can be decoded as an image before upload
- Optional title and note
- Private upload to the existing `capture-images` Supabase Storage bucket
- One `image` capture and one attachment record finalized in a database transaction
- Authenticated image display using a short-lived signed URL
- Image previews in the library and capture detail
- Full-capture deletion that removes the Storage object and database records
- Retained form values and selected file after recoverable failures
- Cleanup of abandoned uploads after failures or interrupted operations
- The same behavior in the Windows PWA and bundled Capacitor application

## Excluded

- Android `ACTION_SEND` image sharing from another application
- Multiple images in one capture
- Removing an image while retaining its capture
- Image editing, cropping, resizing, or compression
- Camera-specific native integration
- GIF, SVG, HEIC, HEIF, PDF, video, audio, or general document uploads
- Tags, favorites, search, and link metadata
- Offline upload queues

The standard browser file picker may offer the camera on Android. Milestone 4A does not depend on
that behavior and does not add a native camera permission.

## Creation contract

1. The client validates the file size and declared MIME type, then decodes it locally. Validation
   does not modify or compress the original.
2. The client creates one capture UUID and one attachment UUID and retains them for retries.
3. The object path is deterministic:
   `{user_id}/{capture_id}/{attachment_id}.{jpg|png|webp}`.
4. Before upload, the client records the pending operation in app-local cleanup state. This is a
   cleanup marker, not an offline capture queue.
5. The client uploads the object with `upsert: false`. The private bucket independently enforces
   the 10 MiB and MIME restrictions.
6. After upload succeeds, the client calls `finalize_image_capture`. The function derives ownership
   from `auth.uid()`, verifies the deterministic path and object existence, and inserts the capture
   and attachment metadata in one PostgreSQL transaction.
7. Only after the RPC succeeds does the interface report success, clear the form, and remove the
   local cleanup marker.

The function is idempotent for the same IDs and metadata. A retry after a lost successful response
returns the existing completed operation instead of creating a duplicate.

If upload fails, no database rows exist and the selected file remains in the form. If finalization
fails, the client removes the uploaded object immediately. A failure to remove it remains an
explicit failure and leaves the cleanup marker available for retry.

## Interrupted-operation cleanup

On the next authenticated online launch, the client first processes its own pending cleanup marker.
It then performs conservative reconciliation for the signed-in user's Storage prefix:

- Ignore objects newer than a safety window so an active upload is never removed.
- Compare older objects with owned attachment metadata.
- Remove an older object only when no attachment row references its exact path.
- Detect an image capture whose attachment metadata points to a missing object and offer/retry
  cleanup of the incomplete database record.
- Never report a failed or reconciled operation as a successful capture save.

The implementation will use a one-hour safety window initially. Reconciliation is deliberately
small and user-scoped; it is not a background worker or general synchronization system.

## Deletion contract

For an image capture, deletion uses Storage-first compensation:

1. Read the owned attachment path while the database records still exist.
2. Remove the private Storage object and confirm the Storage request succeeded.
3. Call `delete_image_capture_after_storage`.
4. The function locks the owned image capture, verifies that its deterministic Storage folder is
   empty, and deletes the capture. Attachment metadata is removed by the existing foreign-key
   cascade.
5. Report deletion success only after the function confirms completion.

If Storage removal fails, database records remain intact and deletion can be retried. If Storage
removal succeeds but the database call fails, the interface reports failure and retries the
database deletion; reconciliation also detects the missing-object record. Calling the deletion
function after the record is already gone succeeds idempotently.

Note and link deletion continues to use the existing direct database deletion path.

## Migration result

The approved migration adds only:

- `public.finalize_image_capture`
- `public.delete_image_capture_after_storage`
- Explicit function execution grants for `authenticated`

It changes no tables, bucket settings, Storage policies, authentication settings, or existing
capture data. Migration `202607240002_image_capture_functions.sql` was explicitly approved and
applied to the linked project on 2026-07-24. Linked migration history, generated RPC types, and
database lint were verified afterward.

## Acceptance criteria

1. JPEG, PNG, and WebP files at or below 10 MiB can be saved from Windows and Android.
2. Unsupported, oversized, or undecodable files are rejected before upload.
3. Images remain private and cannot be retrieved anonymously or by another account.
4. No success appears until Storage upload and transactional metadata finalization both succeed.
5. A failed upload or finalization retains the local draft where practical.
6. Retrying the same pending operation does not create duplicate records or objects.
7. Inbox, Reviewed, and Archived views display authenticated image previews.
8. Opening an image capture displays the full image, title, note, and lifecycle controls.
9. Deleting an image capture removes its Storage object, attachment metadata, and capture record.
10. Failed deletion never silently claims success and remains recoverable.
11. Reconciliation removes only old, unreferenced objects owned by the signed-in user.
12. Existing note/link capture, Android text sharing, and lifecycle behavior remain unchanged.
13. Web checks, Android lint, APK assembly, and physical cross-device tests pass.

## Acceptance result

Milestone 4A passed physical testing on the Huawei P40 Pro and local Windows application. A real
image was selected inside the Android app, validated, uploaded privately, finalized as an inbox
capture, and displayed on both clients. Editing and lifecycle behavior remained available.

Permanent deletion removed the capture from both clients and removed its object from the private
`capture-images` Supabase Storage bucket. This confirms that deleting an image capture releases its
Storage allocation rather than leaving only an inaccessible metadata record.

All 27 automated tests, formatting, lint, strict TypeScript, production PWA build, Android lint, and
debug APK assembly passed. A live anonymous RPC probe was rejected with PostgreSQL permission code
`42501`.

Android image sharing from another application's Share menu remains deferred to Milestone 4B.
