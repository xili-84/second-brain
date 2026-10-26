package net.okdaily.brain.bridge;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int MAX_DIAGNOSTIC_QUERY_LENGTH = 3500;

    private String sharedTitle = "";
    private String sharedText = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        render(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        render(intent);
    }

    private void render(Intent intent) {
        boolean receivedShare = Intent.ACTION_SEND.equals(intent.getAction())
                && "text/plain".equals(intent.getType());

        sharedTitle = receivedShare ? firstNonBlank(
                readText(intent, Intent.EXTRA_TITLE),
                readText(intent, Intent.EXTRA_SUBJECT)
        ) : "";
        sharedText = receivedShare ? readText(intent, Intent.EXTRA_TEXT) : "";

        setContentView(receivedShare ? createShareScreen() : createReadyScreen());
    }

    private View createReadyScreen() {
        LinearLayout content = createContentColumn();
        content.addView(createHeading(getString(R.string.bridge_ready)));
        content.addView(createBody(getString(R.string.bridge_ready_explanation)));
        return wrapInScrollView(content);
    }

    private View createShareScreen() {
        LinearLayout content = createContentColumn();
        content.addView(createEyebrow(getString(R.string.android_diagnostic)));
        content.addView(createHeading(getString(R.string.share_received)));
        content.addView(createBody(getString(R.string.nothing_saved)));

        TextView preview = createBody(isBlank(sharedText)
                ? getString(R.string.no_text_provided)
                : sharedText);
        preview.setBackgroundColor(getColor(R.color.panel));
        preview.setPadding(dp(16), dp(16), dp(16), dp(16));
        content.addView(preview);

        int queryLength = sharedTitle.length() + sharedText.length();
        boolean canOpenDiagnostic = queryLength <= MAX_DIAGNOSTIC_QUERY_LENGTH;

        if (!canOpenDiagnostic) {
            TextView warning = createBody(getString(R.string.test_too_long));
            warning.setTextColor(getColor(R.color.coral));
            content.addView(warning);
        }

        Button openButton = new Button(this);
        openButton.setText(R.string.open_web_diagnostic);
        openButton.setAllCaps(false);
        openButton.setEnabled(canOpenDiagnostic);
        openButton.setOnClickListener(ignored -> openWebDiagnostic());
        content.addView(openButton, buttonLayoutParams());

        Button closeButton = new Button(this);
        closeButton.setText(R.string.close);
        closeButton.setAllCaps(false);
        closeButton.setOnClickListener(ignored -> finish());
        content.addView(closeButton, buttonLayoutParams());

        return wrapInScrollView(content);
    }

    private void openWebDiagnostic() {
        Uri.Builder uri = new Uri.Builder()
                .scheme("https")
                .authority("brain.okdaily.net")
                .appendPath("share");

        if (!isBlank(sharedTitle)) {
            uri.appendQueryParameter("title", sharedTitle);
        }

        if (isHttpUrl(sharedText)) {
            uri.appendQueryParameter("url", sharedText);
        } else if (!isBlank(sharedText)) {
            uri.appendQueryParameter("text", sharedText);
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri.build()));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, R.string.no_browser_available, Toast.LENGTH_LONG).show();
        }
    }

    private static boolean isHttpUrl(String value) {
        if (isBlank(value)) {
            return false;
        }

        for (int index = 0; index < value.length(); index++) {
            if (Character.isWhitespace(value.charAt(index))) {
                return false;
            }
        }

        Uri uri = Uri.parse(value);
        return "http".equalsIgnoreCase(uri.getScheme())
                || "https".equalsIgnoreCase(uri.getScheme());
    }

    private static boolean isBlank(String value) {
        return TextUtils.isEmpty(value);
    }

    private static String readText(Intent intent, String key) {
        CharSequence value = intent.getCharSequenceExtra(key);
        return value == null ? "" : value.toString().trim();
    }

    private static String firstNonBlank(String first, String second) {
        return TextUtils.isEmpty(first) ? second : first;
    }

    private LinearLayout createContentColumn() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(48), dp(24), dp(32));
        content.setBackgroundColor(getColor(R.color.navy));
        return content;
    }

    private ScrollView wrapInScrollView(View content) {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.addView(content);
        return scrollView;
    }

    private TextView createEyebrow(String text) {
        TextView view = createBody(text);
        view.setTextColor(getColor(R.color.coral));
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setAllCaps(true);
        return view;
    }

    private TextView createHeading(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(getColor(R.color.white));
        view.setTextSize(32);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setPadding(0, dp(12), 0, dp(20));
        return view;
    }

    private TextView createBody(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(getColor(R.color.muted));
        view.setTextSize(17);
        view.setLineSpacing(0, 1.25f);
        view.setPadding(0, 0, 0, dp(20));
        return view;
    }

    private LinearLayout.LayoutParams buttonLayoutParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, dp(10), 0, 0);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
