package com.blueguardian.hybrid;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BlueGuardianBluetoothPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
