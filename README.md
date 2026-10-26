# Second Brain

Private, low-friction knowledge capture for Android and Windows.

Version 1 is complete and accepted through Milestone 4A: authenticated note, link, and private image
capture; cross-device review; lifecycle management; and deletion. Physical Huawei P40 Pro testing
confirmed the Android share-to-Windows-inbox workflow, private image capture, and the Inbox,
Reviewed, and Archived lifecycle.

Two post-Version-1 Android extensions are implemented: receiving a JPEG, PNG, or WebP from the
system Share menu and saving a private image into `Pictures/Second Brain`. Repository checks,
Android lint, and APK assembly pass. Their physical Huawei acceptance tests remain pending, so the
successful diagnostic bridge is still preserved as a fallback.

The Milestone 2 web build is live at `https://brain.okdaily.net` and passed its production
acceptance checks on 2026-07-24. Milestone 3 passed local Windows and Huawei acceptance on the same
date and was manually deployed. Milestone 4A private image capture passed local Windows and Huawei
acceptance on the same date and is ready for manual web deployment.

## Requirements

- Node.js 20.19 or newer (Node.js 22 or 24 is recommended)
- npm
- Eclipse Temurin JDK 21 for the Capacitor Android build
- Android SDK Platform 36 and Build Tools 36.0.0

## Run locally

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Start the development server:

   ```powershell
   npm.cmd run dev
   ```

3. Open the local URL printed by Vite and sign in with the private Supabase account.

The local application requires `.env.local` with the project URL and browser-safe publishable key.
Never put a secret or service-role key in a `VITE_` variable.

## Android applications

The production Capacitor source is under [`android/`](android/). Build, sync, lint, and assemble it
with:

```powershell
npm.cmd run android:check
```

The debug APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`.

The proven dependency-free diagnostic is preserved separately under
[`android-diagnostic/`](android-diagnostic/). It remains package `net.okdaily.brain.bridge`, while
the production Capacitor application uses `net.okdaily.brain`.

## Share diagnostic

During desktop development, the GET receiver can be inspected with harmless values:

```text
/share?title=Harmless%20test&text=Shared%20text&url=https%3A%2F%2Fexample.com
```

Actual Android Share Target registration requires an HTTPS deployment and installation on the
phone. The diagnostic does not store data.

Huawei P40 Pro testing showed that its available browsers do not register the PWA in EMUI's Share
menu. The approved optional `ACTION_SEND` diagnostic bridge is documented in
[`android-diagnostic/README.md`](android-diagnostic/README.md). Its physical compatibility test
passed. The diagnostic will remain available until the real Capacitor capture path replaces it
successfully.

## Local checks

```powershell
npm.cmd run check
```

The initial Supabase migration under `supabase/migrations/` was applied to the remote project after
explicit approval on 2026-07-24. All future schema changes must use new versioned migrations.

The manual Namecheap diagnostic procedure is documented in
[`docs/deployment.md`](docs/deployment.md).

The approved system boundary, Supabase setup gate, and next milestone are recorded in
[`docs/architecture.md`](docs/architecture.md), [`docs/supabase-setup.md`](docs/supabase-setup.md),
[`docs/milestone-2.md`](docs/milestone-2.md), and
[`docs/milestone-3.md`](docs/milestone-3.md), and
[`docs/milestone-4a.md`](docs/milestone-4a.md). Post-Version-1 Android work is tracked in
[`docs/milestone-4b.md`](docs/milestone-4b.md) and
[`docs/milestone-4c.md`](docs/milestone-4c.md).
