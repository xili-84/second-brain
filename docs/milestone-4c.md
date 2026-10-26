# Milestone 4C: save a private image to Android

Status: implementation and automated checks complete; physical Huawei P40 Pro acceptance pending.
This is a post-Version-1 extension.

## Goal

Let the authenticated Android user deliberately save a private Second Brain image into the phone's
photo library without exposing its signed URL or publishing a partial download.

## Contract

- Show **Save to phone** only in the native application and only for an image capture.
- Use the existing short-lived private Storage URL; do not make the bucket or object public.
- Download first into an app-private temporary file.
- Accept only JPEG, PNG, or WebP and enforce the expected byte count and 10 MiB limit.
- Publish only after the complete download succeeds.
- Save into `Pictures/Second Brain`.
- Use MediaStore without broad storage permission on Android 10 and newer.
- Request legacy write permission on Android 9 and older only after the user presses the button.
- Remove partial or temporary files after failures and never report a failed save as successful.
- Keep Capacitor bridge logging disabled so signed URLs and image bytes do not enter Android logs.

## Acceptance criteria

1. **Save to phone** appears for an image in the Android app and not in the web application.
2. Saving a JPEG, PNG, and WebP creates a readable image in `Pictures/Second Brain`.
3. A failed or interrupted download leaves no published partial image and shows no success.
4. Repeated saves use distinct filenames instead of overwriting an existing image.
5. Android 10 and newer do not request broad storage permission.
6. Existing image display, editing, lifecycle actions, and deletion remain unchanged.
7. Repository checks, Android lint, and debug APK assembly pass.

## Current verification

On 2026-07-25, formatting, lint, strict TypeScript, all 32 automated tests, the production PWA
build, Android lint, and debug APK assembly passed with JDK 21 and the repository Gradle Wrapper.
Criteria 1 through 6 still require the physical Huawei test before this milestone can be marked
accepted.
