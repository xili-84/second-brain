package net.okdaily.brain;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Checks GitHub Releases for a newer signed APK, downloads it into the app's cache and hands it to
 * the system package installer. Only release assets of this repository are accepted, and the
 * downloaded APK must be this app, a higher versionCode and signed with the same key before the
 * installer is opened (Android enforces the same signature again when it installs the update).
 */
@CapacitorPlugin(name = "AppUpdater")
public final class AppUpdaterPlugin extends Plugin {
    private static final String LATEST_RELEASE_URL =
            "https://api.github.com/repos/xili-84/second-brain/releases/latest";
    private static final String ASSET_URL_PREFIX =
            "https://github.com/xili-84/second-brain/releases/download/";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String UPDATE_DIRECTORY = "updates";
    private static final long MAX_APK_BYTES = 150L * 1024L * 1024L;
    private static final int MAX_API_RESPONSE_BYTES = 1024 * 1024;

    /** The APK downloaded last, waiting for the user to allow installs from this app. */
    private File pendingApk;

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            PackageInfo info = installedPackage(0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName);
            result.put("versionCode", PackageInfoCompat.getLongVersionCode(info));
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException error) {
            call.reject("Version information is not available.");
        }
    }

    /** Reads the latest published release. Resolves with the tag and its APK, or rejects. */
    @PluginMethod
    public void checkLatest(PluginCall call) {
        execute(() -> {
            try {
                call.resolve(readLatestRelease());
            } catch (Exception error) {
                call.reject("Could not check for updates.");
            }
        });
    }

    /** Downloads the APK asset of a release (only from this repository) and opens the installer. */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        long expectedSize = call.getLong("size", 0L);

        if (TextUtils.isEmpty(url) || !url.startsWith(ASSET_URL_PREFIX) || !url.endsWith(".apk")) {
            call.reject("This update can't be downloaded.");
            return;
        }

        if (expectedSize <= 0 || expectedSize > MAX_APK_BYTES) {
            call.reject("This update can't be downloaded.");
            return;
        }

        execute(() -> {
            File apk = null;

            try {
                apk = download(url, expectedSize);
                verifyUpdate(apk);
            } catch (UpdateException error) {
                deleteQuietly(apk);
                call.reject(error.getMessage());
                return;
            } catch (Exception error) {
                deleteQuietly(apk);
                call.reject("The download failed. Check your connection and try again.");
                return;
            }

            File verified = apk;
            getActivity().runOnUiThread(() -> install(call, verified));
        });
    }

    /** Retries the install of the downloaded APK, for example after allowing this source. */
    @PluginMethod
    public void installPending(PluginCall call) {
        File apk = pendingApk;

        if (apk == null || !apk.isFile()) {
            call.reject("No downloaded update is waiting.");
            return;
        }

        install(call, apk);
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", canRequestInstalls());
        result.put("pending", pendingApk != null && pendingApk.isFile());
        call.resolve(result);
    }

    private void install(PluginCall call, File apk) {
        pendingApk = apk;
        JSObject result = new JSObject();

        if (!canRequestInstalls()) {
            result.put("status", "permission-required");
            openInstallSettings();
            call.resolve(result);
            return;
        }

        Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, APK_MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getActivity().startActivity(intent);
            result.put("status", "installer-opened");
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("No installer is available on this phone.");
        }
    }

    private boolean canRequestInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException error) {
            Intent fallback = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            try {
                getActivity().startActivity(fallback);
            } catch (ActivityNotFoundException ignored) {
                // The JS side explains where to allow it.
            }
        }
    }

    private JSObject readLatestRelease() throws IOException, JSONException {
        HttpURLConnection connection = (HttpURLConnection) new URL(LATEST_RELEASE_URL).openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(15_000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
        connection.setRequestProperty("User-Agent", "SecondBrain-Android");

        try {
            int status = connection.getResponseCode();

            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException("HTTP " + status);
            }

            JSONObject release;

            try (InputStream input = connection.getInputStream()) {
                release = new JSONObject(readLimited(input));
            }

            JSObject result = new JSObject();
            result.put("tag", release.optString("tag_name", ""));
            result.put("name", release.optString("name", ""));
            result.put("htmlUrl", release.optString("html_url", ""));
            result.put("publishedAt", release.optString("published_at", ""));

            JSONArray assets = release.optJSONArray("assets");

            if (assets != null) {
                for (int index = 0; index < assets.length(); index += 1) {
                    JSONObject asset = assets.optJSONObject(index);

                    if (asset == null) {
                        continue;
                    }

                    String name = asset.optString("name", "");
                    String url = asset.optString("browser_download_url", "");

                    if (name.toLowerCase(Locale.ROOT).endsWith(".apk") && url.startsWith(ASSET_URL_PREFIX)) {
                        result.put("apkName", name);
                        result.put("apkUrl", url);
                        result.put("apkSize", asset.optLong("size", 0L));
                        break;
                    }
                }
            }

            return result;
        } finally {
            connection.disconnect();
        }
    }

    private static String readLimited(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;

        while ((read = input.read(buffer)) != -1) {
            if (output.size() + read > MAX_API_RESPONSE_BYTES) {
                throw new IOException("Response too large");
            }

            output.write(buffer, 0, read);
        }

        return output.toString(StandardCharsets.UTF_8.name());
    }

    private File download(String url, long expectedSize) throws IOException, UpdateException {
        File directory = new File(getContext().getCacheDir(), UPDATE_DIRECTORY);

        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not create the update folder");
        }

        File[] old = directory.listFiles();

        if (old != null) {
            for (File file : old) {
                deleteQuietly(file);
            }
        }

        File target = new File(directory, "second-brain-update.apk");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "SecondBrain-Android");

        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("HTTP " + connection.getResponseCode());
            }

            if (!"https".equalsIgnoreCase(connection.getURL().getProtocol())) {
                throw new UpdateException("This update can't be downloaded.");
            }

            long declared = connection.getContentLengthLong();

            if (declared > MAX_APK_BYTES || (declared > 0 && declared != expectedSize)) {
                throw new UpdateException("The update download did not match the release.");
            }

            long total = 0L;
            int lastPercent = -1;

            try (
                    InputStream input = connection.getInputStream();
                    OutputStream output = new FileOutputStream(target)
            ) {
                byte[] buffer = new byte[64 * 1024];
                int read;

                while ((read = input.read(buffer)) != -1) {
                    total += read;

                    if (total > expectedSize || total > MAX_APK_BYTES) {
                        throw new UpdateException("The update download did not match the release.");
                    }

                    output.write(buffer, 0, read);
                    int percent = (int) (total * 100L / expectedSize);

                    if (percent != lastPercent) {
                        lastPercent = percent;
                        JSObject progress = new JSObject();
                        progress.put("percent", percent);
                        notifyListeners("downloadProgress", progress);
                    }
                }

                output.flush();
            }

            if (total != expectedSize) {
                throw new UpdateException("The update download was incomplete. Try again.");
            }

            return target;
        } catch (IOException | UpdateException error) {
            deleteQuietly(target);
            throw error;
        } finally {
            connection.disconnect();
        }
    }

    private void verifyUpdate(File apk) throws UpdateException {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : signaturesFlag();
        PackageInfo update = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);

        if (update == null || !getContext().getPackageName().equals(update.packageName)) {
            throw new UpdateException("The downloaded file is not a Second Brain update.");
        }

        PackageInfo installed;

        try {
            installed = installedPackage(flags);
        } catch (PackageManager.NameNotFoundException error) {
            throw new UpdateException("Version information is not available.");
        }

        if (PackageInfoCompat.getLongVersionCode(update) <= PackageInfoCompat.getLongVersionCode(installed)) {
            throw new UpdateException("This version is already installed.");
        }

        Set<String> installedCerts = certificateDigests(installed);
        Set<String> updateCerts = certificateDigests(update);

        // Before Android 9 archive signatures are often not reported; the installer still refuses
        // an update signed with another key, so only compare when both sides are known.
        boolean unknownArchiveSigner = Build.VERSION.SDK_INT < Build.VERSION_CODES.P && updateCerts.isEmpty();

        if (!unknownArchiveSigner && (installedCerts.isEmpty() || !installedCerts.equals(updateCerts))) {
            throw new UpdateException("The update is not signed with the Second Brain key, so it was not installed.");
        }
    }

    @SuppressWarnings("deprecation")
    private static int signaturesFlag() {
        return PackageManager.GET_SIGNATURES;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> certificateDigests(PackageInfo info) {
        Signature[] signatures = null;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signingInfo = info.signingInfo;

            if (signingInfo != null) {
                signatures = signingInfo.hasMultipleSigners()
                        ? signingInfo.getApkContentsSigners()
                        : signingInfo.getSigningCertificateHistory();
            }
        } else {
            signatures = info.signatures;
        }

        Set<String> digests = new HashSet<>();

        if (signatures == null) {
            return digests;
        }

        for (Signature signature : signatures) {
            digests.add(sha256(signature.toByteArray()));
        }

        return digests;
    }

    private static String sha256(byte[] value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
            StringBuilder hex = new StringBuilder(digest.length * 2);

            for (byte part : digest) {
                hex.append(String.format(Locale.ROOT, "%02x", part));
            }

            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            return Arrays.toString(value);
        }
    }

    @SuppressWarnings("deprecation")
    private PackageInfo installedPackage(int flags) throws PackageManager.NameNotFoundException {
        PackageManager manager = getContext().getPackageManager();
        String name = getContext().getPackageName();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return manager.getPackageInfo(name, PackageManager.PackageInfoFlags.of(flags));
        }

        return manager.getPackageInfo(name, flags);
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists() && !file.delete()) {
            file.deleteOnExit();
        }
    }

    private static final class UpdateException extends Exception {
        private UpdateException(String message) {
            super(message);
        }
    }
}
