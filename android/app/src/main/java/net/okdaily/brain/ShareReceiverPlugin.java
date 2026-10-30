package net.okdaily.brain;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "ShareReceiver")
public final class ShareReceiverPlugin extends Plugin {
    private static final long MAX_IMAGE_BYTES = 10L * 1024L * 1024L;
    /** Matches MAX_IMAGES_PER_CAPTURE in the web app. */
    private static final int MAX_SHARED_IMAGES = 10;
    private static final int IMAGE_CHUNK_BYTES = 192 * 1024;
    private static final String PREFERENCES_NAME = "second_brain_pending_share";
    private static final String PENDING_DIRECTORY = "pending-shares";
    private static final String KEY_ERROR = "error";
    private static final String KEY_ID = "id";
    private static final String KEY_IMAGE_MIME_TYPE = "image_mime_type";
    private static final String KEY_IMAGE_NAME = "image_name";
    private static final String KEY_IMAGE_SIZE = "image_size";
    private static final String KEY_IMAGE_URI = "image_uri";
    /** JSON array of every pending image (current builds); the single-image keys are legacy. */
    private static final String KEY_IMAGES = "images";
    private static final String KEY_KIND = "kind";
    private static final String KEY_RECEIVED_AT = "received_at";
    private static final String KEY_TEXT = "text";
    private static final String KEY_TITLE = "title";
    private static final String KIND_IMAGE = "image";
    private static final String KIND_TEXT = "text";

    @Override
    public void load() {
        processIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        processIntent(intent);
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        JSObject result = new JSObject();
        JSObject pendingShare = readPendingShare();

        if (pendingShare != null) {
            result.put("pendingShare", pendingShare);
        }

        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingShare(PluginCall call) {
        String expectedId = call.getString(KEY_ID);

        if (TextUtils.isEmpty(expectedId)) {
            call.reject("A pending share ID is required.");
            return;
        }

        SharedPreferences preferences = preferences();
        String currentId = preferences.getString(KEY_ID, "");

        if (expectedId.equals(currentId)) {
            clearStoredShare();
        }

        call.resolve();
    }

    @PluginMethod
    public void readPendingImageChunk(PluginCall call) {
        String expectedId = call.getString(KEY_ID);
        Integer requestedOffset = call.getInt("offset", 0);
        Integer requestedIndex = call.getInt("index", 0);
        SharedPreferences preferences = preferences();

        if (
                TextUtils.isEmpty(expectedId)
                        || !expectedId.equals(preferences.getString(KEY_ID, ""))
        ) {
            call.reject("The pending image is no longer available.");
            return;
        }

        if (requestedOffset == null || requestedOffset < 0) {
            call.reject("A valid image offset is required.");
            return;
        }

        List<String> imageUris = storedImageUris(preferences);

        if (requestedIndex == null || requestedIndex < 0 || requestedIndex >= imageUris.size()) {
            call.reject("The requested pending image does not exist.");
            return;
        }

        File imageFile = privateImageFile(imageUris.get(requestedIndex));

        if (imageFile == null || !imageFile.isFile()) {
            call.reject("The pending image file is unavailable.");
            return;
        }

        long fileSize = imageFile.length();

        if (requestedOffset > fileSize) {
            call.reject("The requested image offset is outside the file.");
            return;
        }

        int length = (int) Math.min(IMAGE_CHUNK_BYTES, fileSize - requestedOffset);
        byte[] bytes = new byte[length];

        try (RandomAccessFile input = new RandomAccessFile(imageFile, "r")) {
            input.seek(requestedOffset);
            input.readFully(bytes);
        } catch (IOException error) {
            call.reject("The pending image could not be read.");
            return;
        }

        int nextOffset = requestedOffset + length;
        JSObject result = new JSObject();
        result.put("complete", nextOffset == fileSize);
        result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        result.put("nextOffset", nextOffset);
        call.resolve(result);
    }

    private void processIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String action = intent.getAction();
        boolean isMultiple = Intent.ACTION_SEND_MULTIPLE.equals(action);

        if (!Intent.ACTION_SEND.equals(action) && !isMultiple) {
            return;
        }

        String mimeType = intent.getType();

        if (!isMultiple && "text/plain".equals(mimeType)) {
            receiveText(intent);
        } else if (mimeType != null && mimeType.startsWith("image/")) {
            receiveImages(intent, readStreamUris(intent, isMultiple));
        } else {
            return;
        }

        intent.setAction(null);
    }

    private void receiveText(Intent intent) {
        String text = readText(intent, Intent.EXTRA_TEXT);
        String title = firstNonBlank(
                readText(intent, Intent.EXTRA_TITLE),
                readText(intent, Intent.EXTRA_SUBJECT)
        );

        if (TextUtils.isEmpty(text) && TextUtils.isEmpty(title)) {
            return;
        }

        JSObject share = baseShare(KIND_TEXT, title, text);
        replacePendingShare(share);
    }

    /**
     * Copies every shared image into private storage, checking each one on its own: content://
     * from another app, JPEG/PNG/WebP, at most 10 MiB, and a matching file signature. Images that
     * fail are skipped (and reported) so one bad item does not lose the rest; at most
     * MAX_SHARED_IMAGES are kept.
     */
    private void receiveImages(Intent intent, List<Uri> sourceUris) {
        String title = firstNonBlank(
                readText(intent, Intent.EXTRA_TITLE),
                readText(intent, Intent.EXTRA_SUBJECT)
        );
        String text = readText(intent, Intent.EXTRA_TEXT);

        if (sourceUris.isEmpty()) {
            replacePendingShare(errorShare(title, text, "The sharing app did not provide an image."));
            return;
        }

        String id = UUID.randomUUID().toString();
        JSArray images = new JSArray();
        String firstProblem = null;
        int skipped = 0;
        int overLimit = 0;

        for (Uri sourceUri : sourceUris) {
            if (images.length() >= MAX_SHARED_IMAGES) {
                overLimit += 1;
                continue;
            }

            String problem;

            try {
                JSObject image = copySharedImage(intent, sourceUri, id, images.length());
                images.put(image);
                continue;
            } catch (SharedImageException error) {
                problem = error.getMessage();
            }

            skipped += 1;

            if (firstProblem == null) {
                firstProblem = problem;
            }
        }

        if (images.length() == 0) {
            replacePendingShare(errorShare(
                    title,
                    text,
                    firstProblem == null ? "The shared images could not be prepared." : firstProblem
            ));
            return;
        }

        JSObject share = baseShare(KIND_IMAGE, title, text);
        share.put(KEY_ID, id);
        share.put(KEY_IMAGES, images);

        try {
            share.put("image", images.getJSONObject(0));
        } catch (JSONException ignored) {
            // The list was just built; index 0 always exists here.
        }

        List<String> notes = new ArrayList<>();

        if (skipped > 0) {
            notes.add(skipped + (skipped == 1 ? " shared item was skipped: " : " shared items were skipped: ")
                    + firstProblem);
        }

        if (overLimit > 0) {
            notes.add("Only the first " + MAX_SHARED_IMAGES + " images were kept.");
        }

        if (!notes.isEmpty()) {
            share.put(KEY_ERROR, TextUtils.join(" ", notes));
        }

        replacePendingShare(share);
    }

    private JSObject copySharedImage(Intent intent, Uri sourceUri, String shareId, int index)
            throws SharedImageException {
        if (!isAllowedSourceUri(sourceUri)) {
            throw new SharedImageException("The sharing app did not provide a readable image.");
        }

        String mimeType = resolveImageMimeType(intent, sourceUri);

        if (!isSupportedImageMime(mimeType)) {
            throw new SharedImageException("Only JPEG, PNG, and WebP images are supported.");
        }

        String displayName = readDisplayName(sourceUri);

        if (TextUtils.isEmpty(displayName)) {
            displayName = "shared-image-" + (index + 1) + "." + extensionFor(mimeType);
        }

        File pendingFile;

        try {
            pendingFile = copyToPrivateCache(sourceUri, shareId + "-" + index, mimeType);
        } catch (ImageTooLargeException error) {
            throw new SharedImageException("The shared image is larger than 10 MiB.");
        } catch (IOException | SecurityException error) {
            throw new SharedImageException("The shared image could not be copied. Please share it again.");
        }

        if (!hasExpectedImageSignature(pendingFile, mimeType)) {
            pendingFile.delete();
            throw new SharedImageException("The shared file contents do not match its image format.");
        }

        JSObject image = new JSObject();
        image.put("index", index);
        image.put("mimeType", mimeType);
        image.put("name", safeDisplayName(displayName, mimeType));
        image.put("size", pendingFile.length());
        image.put("uri", Uri.fromFile(pendingFile).toString());
        return image;
    }

    private JSObject errorShare(String title, String text, String message) {
        JSObject share = baseShare(KIND_IMAGE, title, text);
        share.put(KEY_ERROR, message);
        return share;
    }

    private JSObject baseShare(String kind, String title, String text) {
        JSObject share = new JSObject();
        share.put(KEY_ID, UUID.randomUUID().toString());
        share.put("receivedAt", currentTimestamp());
        share.put(KEY_KIND, kind);
        share.put(KEY_TEXT, text);
        share.put(KEY_TITLE, title);
        return share;
    }

    private void replacePendingShare(JSObject share) {
        clearStoredShare();
        savePendingShare(share);
        notifyListeners("shareReceived", share, true);
    }

    private void savePendingShare(JSObject share) {
        SharedPreferences.Editor editor = preferences()
                .edit()
                .putString(KEY_ID, share.getString(KEY_ID))
                .putString(KEY_RECEIVED_AT, share.getString("receivedAt"))
                .putString(KEY_KIND, share.getString(KEY_KIND))
                .putString(KEY_TEXT, share.getString(KEY_TEXT))
                .putString(KEY_TITLE, share.getString(KEY_TITLE));

        String error = share.getString(KEY_ERROR);

        if (!TextUtils.isEmpty(error)) {
            editor.putString(KEY_ERROR, error);
        }

        JSONArray images = share.optJSONArray(KEY_IMAGES);

        if (images != null) {
            editor.putString(KEY_IMAGES, images.toString());
        }

        editor.apply();
    }

    private JSObject readPendingShare() {
        SharedPreferences preferences = preferences();
        String id = preferences.getString(KEY_ID, "");

        if (TextUtils.isEmpty(id)) {
            return null;
        }

        JSObject share = new JSObject();
        share.put(KEY_ID, id);
        share.put("receivedAt", preferences.getString(KEY_RECEIVED_AT, ""));
        share.put(KEY_KIND, preferences.getString(KEY_KIND, KIND_TEXT));
        share.put(KEY_TEXT, preferences.getString(KEY_TEXT, ""));
        share.put(KEY_TITLE, preferences.getString(KEY_TITLE, ""));

        String error = preferences.getString(KEY_ERROR, "");

        if (!TextUtils.isEmpty(error)) {
            share.put(KEY_ERROR, error);
        }

        JSArray images = storedImages(preferences);

        if (images.length() > 0) {
            share.put(KEY_IMAGES, images);

            try {
                share.put("image", images.getJSONObject(0));
            } catch (JSONException ignored) {
                // Checked above: the list is not empty.
            }
        }

        return share;
    }

    /** Pending images from the current JSON list, or the single legacy image of older builds. */
    private JSArray storedImages(SharedPreferences preferences) {
        JSArray images = new JSArray();
        String json = preferences.getString(KEY_IMAGES, "");

        if (!TextUtils.isEmpty(json)) {
            try {
                JSONArray stored = new JSONArray(json);

                for (int index = 0; index < stored.length(); index += 1) {
                    JSONObject item = stored.getJSONObject(index);
                    JSObject image = new JSObject();
                    image.put("index", index);
                    image.put("mimeType", item.optString("mimeType", ""));
                    image.put("name", item.optString("name", "shared-image"));
                    image.put("size", item.optLong("size", 0L));
                    image.put("uri", item.optString("uri", ""));
                    images.put(image);
                }
            } catch (JSONException ignored) {
                // A damaged list is treated as no images; clearing the share removes the files.
            }

            return images;
        }

        String imageUri = preferences.getString(KEY_IMAGE_URI, "");

        if (!TextUtils.isEmpty(imageUri)) {
            JSObject image = new JSObject();
            image.put("index", 0);
            image.put("mimeType", preferences.getString(KEY_IMAGE_MIME_TYPE, ""));
            image.put("name", preferences.getString(KEY_IMAGE_NAME, "shared-image"));
            image.put("size", preferences.getLong(KEY_IMAGE_SIZE, 0L));
            image.put("uri", imageUri);
            images.put(image);
        }

        return images;
    }

    private List<String> storedImageUris(SharedPreferences preferences) {
        List<String> uris = new ArrayList<>();
        JSArray images = storedImages(preferences);

        for (int index = 0; index < images.length(); index += 1) {
            JSONObject image = images.optJSONObject(index);
            uris.add(image == null ? "" : image.optString("uri", ""));
        }

        return uris;
    }

    private void clearStoredShare() {
        for (String imageUri : storedImageUris(preferences())) {
            deletePrivateImage(imageUri);
        }

        preferences().edit().clear().apply();
    }

    private void deletePrivateImage(String imageUri) {
        File imageFile = privateImageFile(imageUri);

        if (imageFile != null) {
            imageFile.delete();
        }
    }

    private File privateImageFile(String imageUri) {
        if (TextUtils.isEmpty(imageUri)) {
            return null;
        }

        String path = Uri.parse(imageUri).getPath();

        if (path == null) {
            return null;
        }

        try {
            File pendingDirectory = new File(getContext().getFilesDir(), PENDING_DIRECTORY);
            File imageFile = new File(path);
            String allowedRoot = pendingDirectory.getCanonicalPath() + File.separator;
            String candidate = imageFile.getCanonicalPath();
            return candidate.startsWith(allowedRoot) ? imageFile : null;
        } catch (IOException ignored) {
            // Cleanup will be retried when this pending share is replaced or explicitly cleared.
            return null;
        }
    }

    private File copyToPrivateCache(Uri sourceUri, String id, String mimeType)
            throws IOException, ImageTooLargeException {
        File directory = new File(getContext().getFilesDir(), PENDING_DIRECTORY);

        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("Could not create the private pending-share directory.");
        }

        File target = new File(directory, id + "." + extensionFor(mimeType));
        long totalBytes = 0L;

        try (
                InputStream input = getContext().getContentResolver().openInputStream(sourceUri);
                FileOutputStream output = new FileOutputStream(target)
        ) {
            if (input == null) {
                throw new IOException("The shared image stream is unavailable.");
            }

            byte[] buffer = new byte[16 * 1024];
            int count;

            while ((count = input.read(buffer)) != -1) {
                totalBytes += count;

                if (totalBytes > MAX_IMAGE_BYTES) {
                    throw new ImageTooLargeException();
                }

                output.write(buffer, 0, count);
            }
        } catch (IOException | ImageTooLargeException error) {
            target.delete();
            throw error;
        }

        if (totalBytes == 0L) {
            target.delete();
            throw new IOException("The shared image is empty.");
        }

        return target;
    }

    private boolean hasExpectedImageSignature(File imageFile, String mimeType) {
        byte[] bytes = new byte[12];

        try (InputStream input = new java.io.FileInputStream(imageFile)) {
            int total = 0;

            while (total < bytes.length) {
                int count = input.read(bytes, total, bytes.length - total);

                if (count == -1) {
                    break;
                }

                total += count;
            }
        } catch (IOException error) {
            return false;
        }

        if ("image/jpeg".equals(mimeType)) {
            return unsigned(bytes[0]) == 0xff
                    && unsigned(bytes[1]) == 0xd8
                    && unsigned(bytes[2]) == 0xff;
        }

        if ("image/png".equals(mimeType)) {
            return unsigned(bytes[0]) == 0x89
                    && unsigned(bytes[1]) == 0x50
                    && unsigned(bytes[2]) == 0x4e
                    && unsigned(bytes[3]) == 0x47
                    && unsigned(bytes[4]) == 0x0d
                    && unsigned(bytes[5]) == 0x0a
                    && unsigned(bytes[6]) == 0x1a
                    && unsigned(bytes[7]) == 0x0a;
        }

        return unsigned(bytes[0]) == 0x52
                && unsigned(bytes[1]) == 0x49
                && unsigned(bytes[2]) == 0x46
                && unsigned(bytes[3]) == 0x46
                && unsigned(bytes[8]) == 0x57
                && unsigned(bytes[9]) == 0x45
                && unsigned(bytes[10]) == 0x42
                && unsigned(bytes[11]) == 0x50;
    }

    private static int unsigned(byte value) {
        return value & 0xff;
    }

    /**
     * Only accept content:// URIs from other apps. A file:// URI or a URI pointing at this app's
     * own provider would make Second Brain read its own private files on behalf of the sender.
     */
    private boolean isAllowedSourceUri(Uri uri) {
        if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            return false;
        }

        String authority = uri.getAuthority();
        String packageName = getContext().getPackageName();
        return !TextUtils.isEmpty(authority)
                && !authority.equals(packageName)
                && !authority.startsWith(packageName + ".");
    }

    /** The provider's own type for this item wins (a multi-share may mix formats or say image/*). */
    private String resolveImageMimeType(Intent intent, Uri sourceUri) {
        String providerType = null;

        try {
            providerType = getContext().getContentResolver().getType(sourceUri);
        } catch (RuntimeException ignored) {
            // Fall back to the type the sharing app declared.
        }

        if (isSupportedImageMime(providerType)) {
            return providerType;
        }

        String intentType = intent.getType();
        return isSupportedImageMime(intentType) ? intentType : providerType;
    }

    private String readDisplayName(Uri sourceUri) {
        try (
                Cursor cursor = getContext()
                        .getContentResolver()
                        .query(sourceUri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)
        ) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                return nameIndex >= 0 ? cursor.getString(nameIndex) : "";
            }
        } catch (RuntimeException ignored) {
            // A generated safe filename is used when the provider exposes no display name.
        }

        return "";
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> readStreamUris(Intent intent, boolean isMultiple) {
        List<Uri> uris = new ArrayList<>();

        if (isMultiple) {
            ArrayList<?> values = null;

            try {
                values = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            } catch (RuntimeException ignored) {
                // A malformed extra falls back to the clip data below.
            }

            if (values != null) {
                for (Object value : values) {
                    if (value instanceof Uri && !uris.contains(value)) {
                        uris.add((Uri) value);
                    }
                }
            }
        } else {
            Object value = intent.getParcelableExtra(Intent.EXTRA_STREAM);

            if (value instanceof Uri) {
                uris.add((Uri) value);
            }
        }

        ClipData clipData = intent.getClipData();

        if (uris.isEmpty() && clipData != null) {
            int count = isMultiple ? clipData.getItemCount() : Math.min(1, clipData.getItemCount());

            for (int index = 0; index < count; index += 1) {
                Uri uri = clipData.getItemAt(index).getUri();

                if (uri != null && !uris.contains(uri)) {
                    uris.add(uri);
                }
            }
        }

        return uris;
    }

    private static String safeDisplayName(String value, String mimeType) {
        String leafName = new File(value).getName().trim();

        if (TextUtils.isEmpty(leafName)) {
            return "shared-image." + extensionFor(mimeType);
        }

        return leafName.length() > 255 ? leafName.substring(leafName.length() - 255) : leafName;
    }

    private static boolean isSupportedImageMime(String mimeType) {
        return "image/jpeg".equals(mimeType)
                || "image/png".equals(mimeType)
                || "image/webp".equals(mimeType);
    }

    private static String extensionFor(String mimeType) {
        if ("image/jpeg".equals(mimeType)) {
            return "jpg";
        }

        if ("image/png".equals(mimeType)) {
            return "png";
        }

        return "webp";
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private static String readText(Intent intent, String key) {
        CharSequence value = intent.getCharSequenceExtra(key);
        return value == null ? "" : value.toString().trim();
    }

    private static String firstNonBlank(String first, String second) {
        return TextUtils.isEmpty(first) ? second : first;
    }

    private static String currentTimestamp() {
        SimpleDateFormat formatter = new SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                Locale.US
        );
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date());
    }

    private static final class ImageTooLargeException extends Exception {}

    private static final class SharedImageException extends Exception {
        SharedImageException(String message) {
            super(message);
        }
    }
}
