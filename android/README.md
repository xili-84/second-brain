# Second Brain Capacitor Android application

This is the production Android container for the shared React application. It uses package
`net.okdaily.brain`, bundles the Vite build locally, and connects directly to the same Supabase
project as the Windows web application.

## Android share handoff

- Android registers `ACTION_SEND` for `text/plain`.
- Android also registers single-image `ACTION_SEND` for JPEG, PNG, and WebP.
- `ShareReceiverPlugin` writes the received title and text to app-private `SharedPreferences`.
- A shared image is copied immediately from Android's temporary content URI into the app's private
  files area. The private copy is limited to 10 MiB and remains available across a retry.
- The plugin returns a pending value on cold start and emits `shareReceived` on warm start.
- React classifies one standalone HTTP/HTTPS URL as a link and everything else as a note.
- React reads a pending image through bounded native chunks, loads it into the existing Image capture
  form, and validates its MIME type, signature, size, and decodability before allowing upload.
- The user must confirm **Save to inbox** before Supabase receives anything.
- A failed save retains both the form draft and the native pending value.
- The native value and temporary image are cleared only after a confirmed save or explicit discard.

Shared content is never passed through a URL, browser history, or Namecheap access log.

## Save an image to the phone

- The image detail screen shows **Save to phone** only inside the Android application.
- `ImageSaverPlugin` downloads the short-lived private Storage URL into an app-private temporary
  file, verifies the expected size and 10 MiB limit, and publishes it only after completion.
- Android 10 and newer use MediaStore and save into `Pictures/Second Brain` without broad storage
  permission. Android 9 and older request write access only when the user presses the button.
- A failed download or publish removes partial files and never reports success.
- Capacitor bridge logging is disabled so signed Storage URLs and private image bytes are not
  written to Android logs.

## Security notes

- Only `content://` URIs from other apps are accepted as shared images. `file://` URIs and URIs
  pointing at this app's own providers are rejected.
- App data is excluded from cloud backup and Android 12+ device transfer
  (`res/xml/data_extraction_rules.xml`).
- The native image chunk size is 192 KiB (a multiple of 3), so base64 chunks are always whole.

## Build

From the repository root (Windows, macOS or Linux):

```bash
npm run android:check
```

This builds the Vite application, copies it into Capacitor, runs Android lint, and assembles:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Capacitor 8 uses JDK 21 and Android SDK 36. Set `ANDROID_HOME` or create `android/local.properties`
with `sdk.dir=...`.

## Release signing

Android only installs an update over an existing app when both are signed with the **same key**.
Keep the keystore outside the repository and create `android/keystore.properties` (git-ignored):

```properties
storeFile=C:/Users/you/keys/second-brain-release.jks
storePassword=...
keyAlias=second-brain
keyPassword=...
```

or set `SECOND_BRAIN_KEYSTORE_FILE`, `SECOND_BRAIN_KEYSTORE_PASSWORD`, `SECOND_BRAIN_KEY_ALIAS`
and `SECOND_BRAIN_KEY_PASSWORD`. Then run `npm run android:release`. Increase `versionCode` in
`app/build.gradle` for every release.

Debug APKs are signed with the debug key of the machine that built them, so a debug APK built on
another computer cannot replace one built on yours: uninstall first (this signs you out and clears
pending shares), or build on your own machine.

Text sharing and private image capture have passed physical Huawei acceptance. Physical acceptance
for image sharing and **Save to phone** is still pending. The retired `android-diagnostic` app is
archived outside the repository.
