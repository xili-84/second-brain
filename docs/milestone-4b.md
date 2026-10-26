# Milestone 4B: Android image sharing

Status: implementation and automated checks complete; physical Huawei P40 Pro acceptance pending.
This is a post-Version-1 extension.

## Goal

Receive one supported image from Android's system Share menu, let the authenticated user review it,
and reuse the accepted private image-capture workflow without saving before explicit confirmation.

## Contract

- Register `ACTION_SEND` for JPEG, PNG, and WebP.
- Copy the shared content URI immediately into app-private storage with a 10 MiB limit.
- Persist one pending share across cold start, authentication, and recoverable save failures.
- Transfer the private copy to React in bounded chunks.
- Reapply MIME, signature, size, and image-decode validation before upload.
- Keep title, note, and image editable before **Save to inbox**.
- Clear the native pending value and private copy only after confirmed save or explicit discard.
- Never place private content in a URL, browser history, or Namecheap access log.

Multiple images, unsupported formats, background upload, and an offline outbox remain excluded.

## Acceptance criteria

1. Sharing one supported image opens the authenticated image capture form on the Huawei P40 Pro.
2. No Supabase write occurs before **Save to inbox**.
3. A confirmed save creates one private image capture visible on Android and Windows.
4. A failed save keeps the draft and pending native image available for retry.
5. Explicit discard creates no capture and removes the app-private temporary copy.
6. Oversized, unsupported, malformed, or unreadable input is rejected without claiming success.
7. Existing text sharing and browser-selected image capture remain unchanged.
8. Repository checks, Android lint, and debug APK assembly pass.

## Current verification

On 2026-07-25, formatting, lint, strict TypeScript, all 32 automated tests, the production PWA
build, Android lint, and debug APK assembly passed with JDK 21 and the repository Gradle Wrapper.
Criteria 1 through 7 still require the physical Huawei test before this milestone can be marked
accepted.
