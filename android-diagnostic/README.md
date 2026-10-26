# Second Brain Android diagnostic bridge

This is an optional proof for Android devices whose browser can install the PWA but cannot register
its Web Share Target with the operating system. It does not replace the PWA.

## Physical result

The compatibility gate passed on a Huawei P40 Pro. The APK installed successfully, appeared as
**Second Brain** in Android's system Share menu, launched from a plain-text share, displayed the
exact shared value, and said **Share received** without claiming that anything was saved.

## Proof boundary

- Registers the app name **Second Brain** for Android `ACTION_SEND` with `text/plain`.
- Receives harmless text or a URL and previews it locally.
- Displays **Share received** and explicitly states that nothing was saved.
- Opens `https://brain.okdaily.net/share` only after the user taps **Open web diagnostic**.
- Does not authenticate, use Supabase, store content, request permissions, or include Google
  services.
- Does not receive images.

The temporary web diagnostic uses a GET URL. Use only harmless test data because URL values can
appear in browser history and hosting access logs. The production capture flow must use a different,
authenticated handoff for private content.

The production replacement will use Capacitor package `net.okdaily.brain`, bundled React assets,
and an app-private native-to-JavaScript handoff. This diagnostic package,
`net.okdaily.brain.bridge`, must remain intact until that replacement passes the same physical
share test.

## Toolchain

- Android SDK command-line tools with Platform 36, Build Tools 36.0.0, and Platform Tools
- JDK 17
- Android Gradle Plugin 9.3.1 and Gradle 9.5.0

Build and check the debug APK from the `android-diagnostic` directory:

```text
gradlew.bat lintDebug assembleDebug
```

The resulting APK is:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Phone test

1. Install the debug APK directly on the Huawei P40 Pro.
2. Open **Second Brain** once. It should say **Android bridge ready**.
3. In another app, share a harmless short text value or HTTPS URL.
4. Choose **Second Brain** in the Android share menu.
5. Confirm the bridge displays **Share received** and the exact test value.
6. Tap **Open web diagnostic**.
7. Confirm `brain.okdaily.net/share` opens and also displays **Share received**.
8. Confirm neither screen says that the content was saved.
