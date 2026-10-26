package net.okdaily.brain;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImageSaverPlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
