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

Release builds are signed with the Second Brain release key:

| Item                 | Value                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Keystore             | PKCS12, alias `brain-release`, RSA 4096, valid until 2059                                         |
| Certificate SHA-256  | `E9:E4:41:8C:E6:1D:37:43:12:7E:91:35:EF:70:EC:4B:A4:7A:71:2E:8B:5F:41:35:86:1F:2B:21:8E:E2:0C:2A` |
| First signed release | 1.1.1 (versionCode 3)                                                                             |

Android only installs an update over an existing app when both are signed with the **same key**,
so every release must use this key. If it is lost, updates can no longer install over the app.
Keep the backup (`brain-release-key-backup.zip`: keystore, `keystore.properties`, restore notes) in
a password manager or encrypted storage plus one offline copy.

The keystore and its passwords live **outside the repository**. `app/build.gradle` reads them from
`android/keystore.properties` (git-ignored; it may be a copy or a symlink to the real file):

```properties
storeFile=/absolute/path/to/brain-release.jks
storePassword=...
keyAlias=brain-release
keyPassword=...
```

or from the environment variables `SECOND_BRAIN_KEYSTORE_FILE`,
`SECOND_BRAIN_KEYSTORE_PASSWORD`, `SECOND_BRAIN_KEY_ALIAS` and `SECOND_BRAIN_KEY_PASSWORD`.
For PKCS12 keystores the store and key passwords are the same. Without either source, release
builds are produced unsigned.

Build and verify:

```bash
npm run android:release      # app/build/outputs/apk/release/app-release.apk and bundle/release/app-release.aab
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

The printed `certificate SHA-256 digest` must match the fingerprint above. Increase `versionCode`
(and `versionName`) in `app/build.gradle` for every release; Android refuses to install a lower or
equal `versionCode` as an update.

### Switching from debug builds

Earlier APKs were debug builds signed with each computer's own debug key. The first time the signed
release is installed, uninstall the old app once (this signs you out and clears any pending share;
captures in Supabase are not affected). Every later release signed with this key installs straight
over the previous one.

Debug APKs (`npm run android:check`) are still signed with the local debug key and cannot update a
release install.

Text sharing, image sharing from Gallery and Files, private image capture and **Save to phone**
have passed physical tests (release 1.1.1). The earlier diagnostic app and the browser `/share`
route are retired.

## Publishing a release and in-app updates

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed:

```bash
# after bumping package.json version, versionName and versionCode and pushing that commit
git tag v1.6.0 && git push origin v1.6.0
```

The workflow checks that the tag matches `package.json` and `versionName`, builds with the
`VITE_SUPABASE_*` repository variables, signs with the keystore from repository secrets
(`SECOND_BRAIN_KEYSTORE_BASE64`, `SECOND_BRAIN_KEYSTORE_PASSWORD`, `SECOND_BRAIN_KEY_ALIAS`,
`SECOND_BRAIN_KEY_PASSWORD`), refuses an APK whose signer is not the fingerprint above, and
publishes `second-brain-X.Y.Z-release.apk`, `brain-dist-vX.Y.Z.zip` (extract into the web root) and
`SHA256SUMS.txt` as a GitHub Release.

The app (`AppUpdaterPlugin`) reads `releases/latest` of this public repository without a token on
launch, at most every six hours, and from **Account → Check for updates**. A newer `vX.Y.Z` tag
shows "Update available"; Update downloads the release's APK into the app cache and opens the
system installer. Before that it confirms the file is `net.okdaily.brain`, has a higher
`versionCode` and is signed with the same key as the installed app. The first time, Android asks to
allow "Install unknown apps" for Second Brain; the install continues when you come back. Offline or
rate-limited checks fail silently.
