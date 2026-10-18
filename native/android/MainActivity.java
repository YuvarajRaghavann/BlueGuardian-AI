package com.blueguardian.hybrid;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BlueGuardianBluetoothPlugin.class);
        registerPlugin(BlueGuardianSecureLinkPlugin.class);
        registerPlugin(BlueGuardianDevicesPlugin.class);
        super.onCreate(savedInstanceState);

        // Intercept Android system and predictive-gesture Back before the Activity
        // exits. React Router owns in-app navigation; the Activity exits only at root.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    finish();
                    return;
                }

                String currentUrl = webView.getUrl();
                String path = "/";
                if (currentUrl != null) {
                    android.net.Uri uri = android.net.Uri.parse(currentUrl);
                    path = uri.getPath() == null ? "/" : uri.getPath();
                }

                if ("/dashboard".equals(path) || "/".equals(path) || path.isEmpty()) {
                    finish();
                    return;
                }

                webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('blueguardian:android-back'))",
                    null
                );
            }
        });
    }
}
