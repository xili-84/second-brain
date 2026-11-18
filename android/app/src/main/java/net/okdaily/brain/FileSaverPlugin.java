package net.okdaily.brain;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.TextUtils;
import androidx.annotation.RequiresApi;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.UUID;

/**
 * Saves a private attachment (any file type) into the public Downloads folder and opens it with
 * another app. The file is fetched from a short-lived signed Supabase URL into the app's cache
 * first, so a failed download never leaves a partial file in Downloads.
 */
@CapacitorPlugin(
        name = "FileSaver",
        permissions = {
            @Permission(
                    alias = "storage",
                    strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
            )
        }
)
public final class FileSaverPlugin extends Plugin {
    /** Matches MAX_FILE_BYTES in the web app (the Supabase free-plan object limit). */
    private static final long MAX_FILE_BYTES = 50L * 1024L * 1024L;
    private static final String FOLDER_NAME = "Second Brain";
    private static final String PUBLIC_LOCATION = "Downloads/" + FOLDER_NAME;
    private static final String TEMP_DIRECTORY = "file-downloads";
    private static final String DEFAULT_MIME = "application/octet-stream";

    @PluginMethod
    public void saveFile(PluginCall call) {
        SaveRequest request = readRequest(call);

        if (request == null) {
            return;
        }

        if (
                Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                        && getPermissionState("storage") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }

        execute(() -> saveInBackground(call, request));
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("Storage access is required to save the file.");
            return;
        }

        saveFile(call);
    }

    /** Opens a file this plugin saved earlier with whichever app the user picks. */
    @PluginMethod
    public void openFile(PluginCall call) {
        String uriText = call.getString("uri");
        String mimeType = call.getString("mimeType");

        if (TextUtils.isEmpty(uriText) || !isOwnSavedUri(Uri.parse(uriText))) {
            call.reject("This file can no longer be opened from here.");
            return;
        }

        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(Uri.parse(uriText), TextUtils.isEmpty(mimeType) ? DEFAULT_MIME : mimeType);
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("No app on this phone can open this type of file.");
        } catch (SecurityException error) {
            call.reject("This file can no longer be opened from here.");
        }
    }

    private boolean isOwnSavedUri(Uri uri) {
        if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            return false;
        }

        String authority = uri.getAuthority();
        return "media".equals(authority)
                || (getContext().getPackageName() + ".fileprovider").equals(authority);
    }

    private SaveRequest readRequest(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String sourceUrl = call.getString("url");
        // Not call.getLong: the bridge delivers sizes under 2 GB as Integer (see PluginArgs).
        long expectedSize = PluginArgs.positiveWholeNumber(call.getData().opt("expectedSize"));

        if (TextUtils.isEmpty(fileName) || TextUtils.isEmpty(sourceUrl) || expectedSize <= 0L) {
            call.reject("The app sent incomplete file details. Please update Second Brain.");
            return null;
        }

        if (expectedSize > MAX_FILE_BYTES) {
            call.reject("This file is larger than 50 MB and can't be saved.");
            return null;
        }

        Uri uri = Uri.parse(sourceUrl);
        String host = uri.getHost();

        if (
                !"https".equalsIgnoreCase(uri.getScheme())
                        || TextUtils.isEmpty(host)
                        || !host.toLowerCase(Locale.US).endsWith(".supabase.co")
        ) {
            call.reject("This download link isn't from Second Brain's storage.");
            return null;
        }

        return new SaveRequest(
                expectedSize,
                safeFileName(fileName),
                TextUtils.isEmpty(mimeType) ? DEFAULT_MIME : mimeType,
                sourceUrl
        );
    }

    private void saveInBackground(PluginCall call, SaveRequest request) {
        try {
            Uri saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? saveWithMediaStore(request)
                    : saveLegacy(request);

            JSObject result = new JSObject();
            result.put("location", PUBLIC_LOCATION);
            result.put("uri", saved.toString());
            call.resolve(result);
        } catch (SaveException error) {
            call.reject(error.getMessage());
        } catch (java.net.UnknownHostException | java.net.SocketTimeoutException error) {
            call.reject("No connection to the file storage. Check your internet and try again.");
        } catch (IOException error) {
            call.reject("The download was interrupted. Check your internet and try again.");
        } catch (SecurityException | IllegalArgumentException | IllegalStateException error) {
            call.reject("Android refused to save to Downloads: " + describe(error));
        }
    }

    private static String describe(Throwable error) {
        String message = error.getMessage();
        return TextUtils.isEmpty(message) ? error.getClass().getSimpleName() : message;
    }

    /** Opens the signed link; the caller reads the body and must disconnect. */
    private static HttpURLConnection openDownload(SaveRequest request) throws IOException, SaveException {
        HttpURLConnection connection = (HttpURLConnection) new URL(request.sourceUrl).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "SecondBrain-Android");
        // Byte-exact body, so the length check below compares like with like.
        connection.setRequestProperty("Accept-Encoding", "identity");

        int responseCode = connection.getResponseCode();

        if (responseCode < 200 || responseCode >= 300) {
            connection.disconnect();

            if (responseCode == 400 || responseCode == 401 || responseCode == 403) {
                throw new SaveException(
                        "The download link was refused (HTTP " + responseCode + "). Try again."
                );
            }

            if (responseCode == 404) {
                throw new SaveException("This file is no longer in storage (HTTP 404).");
            }

            throw new SaveException("The file storage answered HTTP " + responseCode + ". Try again later.");
        }

        long contentLength = connection.getContentLengthLong();

        if (contentLength > MAX_FILE_BYTES) {
            connection.disconnect();
            throw new SaveException("This file is larger than 50 MB and can't be saved.");
        }

        return connection;
    }

    /** Streams the response into the output and checks that every byte arrived. */
    private static void copyDownload(HttpURLConnection connection, SaveRequest request, OutputStream output)
            throws IOException, SaveException {
        long total = 0L;

        try (InputStream input = connection.getInputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int count;

            while ((count = input.read(buffer)) != -1) {
                total += count;

                if (total > MAX_FILE_BYTES || total > request.expectedSize) {
                    throw new SaveException("The downloaded file is bigger than expected. Try again.");
                }

                output.write(buffer, 0, count);
            }

            output.flush();
        }

        if (total != request.expectedSize) {
            throw new SaveException("The download was incomplete. Check your internet and try again.");
        }
    }

    /**
     * Android 10+: streams the download straight into a pending Downloads entry, then publishes it.
     * A failed download deletes the entry, so nothing half-written is ever visible in Downloads.
     */
    @RequiresApi(Build.VERSION_CODES.Q)
    private Uri saveWithMediaStore(SaveRequest request) throws IOException, SaveException {
        ContentResolver resolver = getContext().getContentResolver();
        HttpURLConnection connection = openDownload(request);
        Uri destination = null;

        try {
            destination = insertDownload(resolver, request.fileName, request.mimeType);

            try (OutputStream output = resolver.openOutputStream(destination, "w")) {
                if (output == null) {
                    throw new SaveException("Android could not open the new file in Downloads.");
                }

                copyDownload(connection, request, output);
            }

            ContentValues completed = new ContentValues();
            completed.put(MediaStore.Downloads.IS_PENDING, 0);

            if (resolver.update(destination, completed, null, null) != 1) {
                throw new SaveException("Android could not finish saving the file to Downloads.");
            }

            Uri saved = destination;
            destination = null;
            return saved;
        } finally {
            connection.disconnect();

            if (destination != null) {
                try {
                    resolver.delete(destination, null, null);
                } catch (RuntimeException ignored) {
                    // The pending entry expires on its own.
                }
            }
        }
    }

    /**
     * Creates the pending entry. Some MIME types (or a MIME that doesn't match the extension) are
     * refused by MediaStore on some phones, so it retries as a generic binary file.
     */
    @RequiresApi(Build.VERSION_CODES.Q)
    private static Uri insertDownload(ContentResolver resolver, String fileName, String mimeType)
            throws SaveException {
        RuntimeException firstError = null;
        String[] candidates = DEFAULT_MIME.equals(mimeType)
                ? new String[] { DEFAULT_MIME }
                : new String[] { mimeType, DEFAULT_MIME };

        for (String candidate : candidates) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, candidate);
            values.put(
                    MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + File.separator + FOLDER_NAME
            );
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            try {
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);

                if (uri != null) {
                    return uri;
                }
            } catch (IllegalArgumentException | IllegalStateException | SecurityException error) {
                if (firstError == null) {
                    firstError = error;
                }
            }
        }

        throw new SaveException(
                "Android refused to create the file in Downloads"
                        + (firstError == null ? "." : ": " + describe(firstError))
        );
    }

    /** Android 9 and older: download to private cache first, then copy into Downloads. */
    private Uri saveLegacy(SaveRequest request) throws IOException, SaveException {
        File directory = new File(getContext().getCacheDir(), TEMP_DIRECTORY);

        if (!directory.exists() && !directory.mkdirs()) {
            throw new SaveException("The app could not prepare a temporary file.");
        }

        File temporary = new File(directory, UUID.randomUUID().toString());
        HttpURLConnection connection = openDownload(request);

        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                copyDownload(connection, request, output);
            }

            try {
                return publishLegacy(temporary, request);
            } catch (IOException error) {
                throw new SaveException("Couldn't write to Downloads: " + describe(error));
            }
        } finally {
            connection.disconnect();
            temporary.delete();
        }
    }

    @SuppressWarnings("deprecation")
    private Uri publishLegacy(File source, SaveRequest request) throws IOException {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File folder = new File(downloads, FOLDER_NAME);

        if (!folder.exists() && !folder.mkdirs()) {
            throw new IOException("The Downloads/Second Brain folder could not be created.");
        }

        File destination = uniqueFile(folder, request.fileName);

        try (FileOutputStream output = new FileOutputStream(destination)) {
            copyFile(source, output);
        } catch (IOException error) {
            destination.delete();
            throw error;
        }

        MediaScannerConnection.scanFile(
                getContext(),
                new String[] { destination.getAbsolutePath() },
                new String[] { request.mimeType },
                null
        );
        return FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                destination
        );
    }

    private static void copyFile(File source, OutputStream output) throws IOException {
        try (FileInputStream input = new FileInputStream(source)) {
            byte[] buffer = new byte[32 * 1024];
            int count;

            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }

            output.flush();
        }
    }

    private static File uniqueFile(File directory, String fileName) {
        File candidate = new File(directory, fileName);

        if (!candidate.exists()) {
            return candidate;
        }

        int dot = fileName.lastIndexOf('.');
        String base = dot > 0 ? fileName.substring(0, dot) : fileName;
        String extension = dot > 0 ? fileName.substring(dot) : "";

        for (int index = 1; index < 10_000; index += 1) {
            candidate = new File(directory, base + " (" + index + ")" + extension);

            if (!candidate.exists()) {
                return candidate;
            }
        }

        return new File(directory, UUID.randomUUID() + extension);
    }

    /** Keeps the user's file name, minus anything a file system or path could misread. */
    private static String safeFileName(String value) {
        String leafName = new File(value).getName()
                .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_")
                .trim();

        if (TextUtils.isEmpty(leafName) || ".".equals(leafName) || "..".equals(leafName)) {
            leafName = "Second-Brain-file";
        }

        if (leafName.length() > 180) {
            int dot = leafName.lastIndexOf('.');
            String extension = dot > 0 && leafName.length() - dot <= 12 ? leafName.substring(dot) : "";
            leafName = leafName.substring(0, 180 - extension.length()) + extension;
        }

        return leafName;
    }

    /** A failure whose message is shown to the user as is. */
    private static final class SaveException extends Exception {
        private SaveException(String message) {
            super(message);
        }
    }

    private static final class SaveRequest {
        private final long expectedSize;
        private final String fileName;
        private final String mimeType;
        private final String sourceUrl;

        private SaveRequest(long expectedSize, String fileName, String mimeType, String sourceUrl) {
            this.expectedSize = expectedSize;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.sourceUrl = sourceUrl;
        }
    }
}
