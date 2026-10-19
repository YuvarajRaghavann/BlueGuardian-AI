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

                // The web app decides: close a sheet, go back a screen, or (at Home) let Android exit.
                webView.evaluateJavascript(
                    "(window.__bgHandleBack ? window.__bgHandleBack() : false)",
                    value -> {
                        if (!"true".equals(value)) finish();
                    }
                );
            }
        });
    }
}
