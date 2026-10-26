package net.okdaily.brain;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.TextUtils;
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

@CapacitorPlugin(
        name = "ImageSaver",
        permissions = {
            @Permission(
                    alias = "storage",
                    strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
            )
        }
)
public final class ImageSaverPlugin extends Plugin {
    private static final long MAX_IMAGE_BYTES = 10L * 1024L * 1024L;
    private static final String ALBUM_NAME = "Second Brain";
    private static final String PUBLIC_LOCATION = "Pictures/" + ALBUM_NAME;
    private static final String TEMP_DIRECTORY = "image-downloads";

    @PluginMethod
    public void saveImage(PluginCall call) {
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

        execute(() -> saveImageInBackground(call, request));
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("Storage access is required to save the image.");
            return;
        }

        saveImage(call);
    }

    private SaveRequest readRequest(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String sourceUrl = call.getString("url");
        Integer expectedSize = call.getInt("expectedSize");

        if (
                TextUtils.isEmpty(fileName)
                        || TextUtils.isEmpty(sourceUrl)
                        || !isSupportedMime(mimeType)
                        || expectedSize == null
                        || expectedSize <= 0L
                        || expectedSize > MAX_IMAGE_BYTES
        ) {
            call.reject("The image download details are invalid.");
            return null;
        }

        Uri uri = Uri.parse(sourceUrl);
        String host = uri.getHost();

        if (
                !"https".equalsIgnoreCase(uri.getScheme())
                        || TextUtils.isEmpty(host)
                        || !host.toLowerCase(Locale.US).endsWith(".supabase.co")
        ) {
            call.reject("Only private Supabase HTTPS images can be saved.");
            return null;
        }

        return new SaveRequest(
                expectedSize.longValue(),
                safeFileName(fileName, mimeType),
                mimeType,
                sourceUrl
        );
    }

    private void saveImageInBackground(PluginCall call, SaveRequest request) {
        File temporaryFile = null;

        try {
            temporaryFile = downloadToPrivateFile(request);
            String location = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? publishWithMediaStore(temporaryFile, request)
                    : publishLegacy(temporaryFile, request);

            JSObject result = new JSObject();
            result.put("location", location);
            call.resolve(result);
        } catch (IOException | SecurityException error) {
            call.reject("The image could not be saved to the phone.");
        } finally {
            if (temporaryFile != null) {
                temporaryFile.delete();
            }
        }
    }

    private File downloadToPrivateFile(SaveRequest request) throws IOException {
        File directory = new File(getContext().getCacheDir(), TEMP_DIRECTORY);

        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("The private download directory could not be created.");
        }

        File target = new File(directory, UUID.randomUUID() + extensionFor(request.mimeType));
        HttpURLConnection connection = null;
        long total = 0L;

        try {
            connection = (HttpURLConnection) new URL(request.sourceUrl).openConnection();
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", request.mimeType);

            int responseCode = connection.getResponseCode();

            if (responseCode < 200 || responseCode >= 300) {
                throw new IOException("The private image download failed.");
            }

            long contentLength = connection.getContentLengthLong();

            if (contentLength > MAX_IMAGE_BYTES) {
                throw new IOException("The private image is too large.");
            }

            try (
                    InputStream input = connection.getInputStream();
                    FileOutputStream output = new FileOutputStream(target)
            ) {
                byte[] buffer = new byte[16 * 1024];
                int count;

                while ((count = input.read(buffer)) != -1) {
                    total += count;

                    if (total > MAX_IMAGE_BYTES) {
                        throw new IOException("The private image is too large.");
                    }

                    output.write(buffer, 0, count);
                }
            }

            if (total != request.expectedSize) {
                throw new IOException("The private image download is incomplete.");
            }

            return target;
        } catch (IOException error) {
            target.delete();
            throw error;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String publishWithMediaStore(File source, SaveRequest request) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, request.fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, request.mimeType);
        values.put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + File.separator + ALBUM_NAME
        );
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri destination = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);

        if (destination == null) {
            throw new IOException("Android could not create the destination image.");
        }

        try (OutputStream output = resolver.openOutputStream(destination, "w")) {
            if (output == null) {
                throw new IOException("Android could not open the destination image.");
            }

            copyFile(source, output);
        } catch (IOException error) {
            resolver.delete(destination, null, null);
            throw error;
        }

        ContentValues completed = new ContentValues();
        completed.put(MediaStore.Images.Media.IS_PENDING, 0);

        if (resolver.update(destination, completed, null, null) != 1) {
            resolver.delete(destination, null, null);
            throw new IOException("Android could not publish the destination image.");
        }

        return PUBLIC_LOCATION;
    }

    @SuppressWarnings("deprecation")
    private String publishLegacy(File source, SaveRequest request) throws IOException {
        File pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
        File album = new File(pictures, ALBUM_NAME);

        if (!album.exists() && !album.mkdirs()) {
            throw new IOException("The Pictures album could not be created.");
        }

        File destination = uniqueFile(album, request.fileName);

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
        return PUBLIC_LOCATION;
    }

    private static void copyFile(File source, OutputStream output) throws IOException {
        try (FileInputStream input = new FileInputStream(source)) {
            byte[] buffer = new byte[16 * 1024];
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

    private static String safeFileName(String value, String mimeType) {
        String leafName = new File(value).getName()
                .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_")
                .trim();

        if (TextUtils.isEmpty(leafName)) {
            leafName = "Second-Brain-image";
        }

        if (!hasExpectedExtension(leafName, mimeType)) {
            leafName += extensionFor(mimeType);
        }

        if (leafName.length() > 180) {
            String extension = extensionFor(mimeType);
            leafName = leafName.substring(0, 180 - extension.length()) + extension;
        }

        return leafName;
    }

    private static boolean hasExpectedExtension(String fileName, String mimeType) {
        String lower = fileName.toLowerCase(Locale.US);

        if ("image/jpeg".equals(mimeType)) {
            return lower.endsWith(".jpg") || lower.endsWith(".jpeg");
        }

        return lower.endsWith(extensionFor(mimeType));
    }

    private static boolean isSupportedMime(String mimeType) {
        return "image/jpeg".equals(mimeType)
                || "image/png".equals(mimeType)
                || "image/webp".equals(mimeType);
    }

    private static String extensionFor(String mimeType) {
        if ("image/jpeg".equals(mimeType)) {
            return ".jpg";
        }

        if ("image/png".equals(mimeType)) {
            return ".png";
        }

        return ".webp";
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
