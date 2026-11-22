package net.okdaily.brain;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        registerPlugin(ImageSaverPlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
        drawEdgeToEdge(getWindow());
    }

    /**
     * Android 15+ always draws apps edge to edge, which is what Capacitor's SystemBars plugin
     * (insetsHandling "css") expects: it hands the status bar, navigation bar and keyboard insets
     * to the WebView. Older Android still fits the window to the system bars and resizes it for the
     * keyboard itself, so those insets were applied twice: an empty band the height of the status
     * bar above every screen, and a keyboard that pushed the composer's header off screen. Opting in
     * to edge-to-edge here makes Android 7–14 lay out exactly like Android 15+.
     */
    @SuppressWarnings("deprecation")
    static void drawEdgeToEdge(Window window) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            return; // Already edge to edge; leave the Android 15+ layout exactly as it is.
        }

        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        ViewCompat.requestApplyInsets(window.getDecorView());
    }
}
