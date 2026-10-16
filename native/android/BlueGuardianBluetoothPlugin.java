package com.blueguardian.hybrid;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(
    name = "BlueGuardianBluetooth",
    permissions = {
        @Permission(alias = "bluetoothScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class BlueGuardianBluetoothPlugin extends Plugin {
    private static final int DEFAULT_SCAN_DURATION_MS = 12000;
    private static final int MIN_SCAN_DURATION_MS = 3000;
    private static final int MAX_SCAN_DURATION_MS = 30000;
    private static final long MIN_EMIT_INTERVAL_MS = 900L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Set<String> seenAddresses = new HashSet<>();
    private final Map<String, Long> lastEmittedAt = new HashMap<>();

    private BluetoothLeScanner activeScanner;
    private ScanCallback activeScanCallback;
    private Runnable stopScanRunnable;
    private int activeDurationMs = DEFAULT_SCAN_DURATION_MS;

    private BluetoothAdapter activeClassicAdapter;
    private BroadcastReceiver classicReceiver;
    private Runnable stopClassicRunnable;
    private final Set<String> classicSeenAddresses = new HashSet<>();
    private int activeClassicDurationMs = DEFAULT_SCAN_DURATION_MS;

    @PluginMethod
    public void startBleScan(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetoothScan") != PermissionState.GRANTED
                || getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
                requestPermissionForAliases(
                    new String[] { "bluetoothScan", "bluetoothConnect" },
                    call,
                    "onModernBluetoothPermissions"
                );
                return;
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            && getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onLegacyLocationPermission");
            return;
        }

        startScanAfterPermissions(call);
    }

    @PermissionCallback
    private void onModernBluetoothPermissions(PluginCall call) {
        if (getPermissionState("bluetoothScan") != PermissionState.GRANTED
            || getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("BlueGuardian needs Nearby Devices permission to scan for BLE devices.");
            return;
        }
        startScanAfterPermissions(call);
    }

    @PermissionCallback
    private void onLegacyLocationPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is required for BLE scanning on this Android version.");
            return;
        }
        startScanAfterPermissions(call);
    }

    @SuppressLint("MissingPermission")
    private void startScanAfterPermissions(PluginCall call) {
        if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            call.reject("This Android device does not report Bluetooth Low Energy support.");
            return;
        }

        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        if (adapter == null) {
            call.reject("Android did not provide a Bluetooth adapter.");
            return;
        }

        try {
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth is turned off. Enable Bluetooth in Android Settings and retry.");
                return;
            }
        } catch (SecurityException error) {
            call.reject("BlueGuardian cannot read Bluetooth state. Grant Nearby Devices permission and retry.");
            return;
        }

        BluetoothLeScanner scanner;
        try {
            scanner = adapter.getBluetoothLeScanner();
        } catch (SecurityException error) {
            call.reject("BlueGuardian cannot access the BLE scanner. Check Nearby Devices permission.");
            return;
        }
        if (scanner == null) {
            call.reject("Android did not provide a BLE scanner. Check that Bluetooth is enabled.");
            return;
        }

        stopBleScanInternal(false);
        seenAddresses.clear();
        lastEmittedAt.clear();

        Integer requestedDuration = call.getInt("durationMs");
        activeDurationMs = requestedDuration == null
            ? DEFAULT_SCAN_DURATION_MS
            : Math.max(MIN_SCAN_DURATION_MS, Math.min(MAX_SCAN_DURATION_MS, requestedDuration));

        activeScanner = scanner;
        activeScanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (activeScanCallback != this) return;
                emitObservation(result);
            }

            @Override
            public void onBatchScanResults(List<ScanResult> results) {
                if (activeScanCallback != this || results == null) return;
                for (ScanResult result : results) emitObservation(result);
            }

            @Override
            public void onScanFailed(int errorCode) {
                if (activeScanCallback != this) return;
                JSObject state = new JSObject();
                state.put("state", "error");
                state.put("code", errorCode);
                state.put("message", scanFailureMessage(errorCode));
                notifyListeners("scanState", state);
                stopBleScanInternal(false);
            }
        };

        try {
            ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
            activeScanner.startScan(null, settings, activeScanCallback);
        } catch (SecurityException error) {
            stopBleScanInternal(false);
            call.reject("Android denied access to Bluetooth scanning. Check Nearby Devices permission.");
            return;
        } catch (RuntimeException error) {
            stopBleScanInternal(false);
            call.reject("Android could not start BLE scanning: " + safeMessage(error));
            return;
        }

        stopScanRunnable = () -> stopBleScanInternal(true);
        mainHandler.postDelayed(stopScanRunnable, activeDurationMs);

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("durationMs", activeDurationMs);
        call.resolve(result);
    }

    @SuppressLint("MissingPermission")
    private void emitObservation(ScanResult result) {
        if (result == null || result.getDevice() == null) return;

        final BluetoothDevice device = result.getDevice();
        final String address;
        try {
            address = device.getAddress();
        } catch (SecurityException error) {
            JSObject state = new JSObject();
            state.put("state", "error");
            state.put("message", "Android withheld the device identifier. Check Nearby Devices permission.");
            notifyListeners("scanState", state);
            stopBleScanInternal(false);
            return;
        }
        if (address == null || address.trim().isEmpty()) return;

        final long now = System.currentTimeMillis();
        seenAddresses.add(address);
        Long last = lastEmittedAt.get(address);
        if (last != null && now - last < MIN_EMIT_INTERVAL_MS) return;
        lastEmittedAt.put(address, now);

        String name = null;
        ScanRecord record = result.getScanRecord();
        if (record != null) name = record.getDeviceName();
        if (name == null || name.trim().isEmpty()) {
            try {
                name = device.getName();
            } catch (SecurityException ignored) {
                // The BLE observation is still useful even when Android withholds its name.
            }
        }
        if (name != null) {
            name = name.replaceAll("[\\p{Cntrl}]", " ").trim();
            if (name.length() > 96) name = name.substring(0, 96);
            if (name.isEmpty()) name = null;
        }

        JSArray serviceUuids = new JSArray();
        if (record != null && record.getServiceUuids() != null) {
            for (ParcelUuid uuid : record.getServiceUuids()) {
                if (uuid != null) serviceUuids.put(uuid.getUuid().toString());
            }
        }

        JSObject observation = new JSObject();
        observation.put("id", address);
        observation.put("address", address);
        if (name != null) observation.put("name", name);
        observation.put("rssi", result.getRssi());
        observation.put("serviceUuids", serviceUuids);
        observation.put("observedAt", now);
        observation.put("transport", "BLE");
        observation.put("source", "REAL");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            observation.put("connectable", result.isConnectable());
        }
        notifyListeners("deviceFound", observation);
    }


    /*
     * Phase 4: classic Bluetooth discovery is a separate foreground scan from
     * BLE advertisement scanning. It only discovers devices currently in
     * classic discovery mode; the paired-device API is provided separately.
     */
    @PluginMethod
    public void startClassicDiscovery(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetoothScan") != PermissionState.GRANTED
                || getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
                requestPermissionForAliases(
                    new String[] { "bluetoothScan", "bluetoothConnect" },
                    call,
                    "onModernClassicPermissions"
                );
                return;
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            && getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onLegacyClassicLocationPermission");
            return;
        }

        startClassicDiscoveryAfterPermissions(call);
    }

    @PermissionCallback
    private void onModernClassicPermissions(PluginCall call) {
        if (getPermissionState("bluetoothScan") != PermissionState.GRANTED
            || getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("BlueGuardian needs Nearby Devices permission for classic Bluetooth discovery.");
            return;
        }
        startClassicDiscoveryAfterPermissions(call);
    }

    @PermissionCallback
    private void onLegacyClassicLocationPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is required for classic Bluetooth discovery on this Android version.");
            return;
        }
        startClassicDiscoveryAfterPermissions(call);
    }

    @SuppressLint("MissingPermission")
    private void startClassicDiscoveryAfterPermissions(PluginCall call) {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        if (adapter == null) {
            call.reject("Android did not provide a Bluetooth adapter.");
            return;
        }

        try {
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth is turned off. Enable Bluetooth in Android Settings and retry.");
                return;
            }
        } catch (SecurityException error) {
            call.reject("BlueGuardian cannot read Bluetooth state. Grant Nearby Devices permission and retry.");
            return;
        }

        stopClassicDiscoveryInternal(false);
        classicSeenAddresses.clear();
        Integer requestedDuration = call.getInt("durationMs");
        activeClassicDurationMs = requestedDuration == null
            ? DEFAULT_SCAN_DURATION_MS
            : Math.max(MIN_SCAN_DURATION_MS, Math.min(MAX_SCAN_DURATION_MS, requestedDuration));
        activeClassicAdapter = adapter;

        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);

        classicReceiver = new BroadcastReceiver() {
            @Override
            @SuppressLint("MissingPermission")
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) return;
                String action = intent.getAction();

                if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                    BluetoothDevice device;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
                    } else {
                        device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    }
                    if (device == null) return;

                    short rssiValue = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, (short) 0);
                    String address;
                    String name = null;
                    try {
                        address = device.getAddress();
                        name = device.getName();
                    } catch (SecurityException error) {
                        emitClassicScanError("Android denied access to classic Bluetooth device details. Check Nearby Devices permission.");
                        return;
                    }
                    if (address == null || address.trim().isEmpty()) return;
                    if (!classicSeenAddresses.add(address)) return;

                    JSObject observation = new JSObject();
                    observation.put("id", address);
                    observation.put("address", address);
                    if (name != null && !name.trim().isEmpty()) {
                        observation.put("name", name.replaceAll("[\\p{Cntrl}]", " ").trim());
                    }
                    observation.put("rssi", (int) rssiValue);
                    observation.put("transport", "CLASSIC");
                    observation.put("source", "REAL");
                    observation.put("paired", device.getBondState() == BluetoothDevice.BOND_BONDED);
                    observation.put("observedAt", System.currentTimeMillis());
                    notifyListeners("classicDeviceFound", observation);
                    return;
                }

                if (BluetoothAdapter.ACTION_DISCOVERY_STARTED.equals(action)) {
                    JSObject state = new JSObject();
                    state.put("state", "scanning");
                    state.put("message", "Classic Bluetooth discovery started.");
                    notifyListeners("classicScanState", state);
                    return;
                }

                if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                    stopClassicDiscoveryInternal(true);
                }
            }
        };

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().registerReceiver(classicReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(classicReceiver, filter);
            }
        } catch (RuntimeException error) {
            classicReceiver = null;
            activeClassicAdapter = null;
            call.reject("BlueGuardian could not register for classic Bluetooth discovery: " + safeMessage(error));
            return;
        }

        try {
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
            boolean started = adapter.startDiscovery();
            if (!started) {
                stopClassicDiscoveryInternal(false);
                call.reject("Android could not start classic Bluetooth discovery. Wait briefly and try again.");
                return;
            }
        } catch (SecurityException error) {
            stopClassicDiscoveryInternal(false);
            call.reject("Android denied classic Bluetooth discovery. Check Nearby Devices permission.");
            return;
        } catch (RuntimeException error) {
            stopClassicDiscoveryInternal(false);
            call.reject("Android could not start classic Bluetooth discovery: " + safeMessage(error));
            return;
        }

        stopClassicRunnable = () -> stopClassicDiscoveryInternal(true);
        mainHandler.postDelayed(stopClassicRunnable, activeClassicDurationMs);

        JSObject state = new JSObject();
        state.put("state", "scanning");
        state.put("durationMs", activeClassicDurationMs);
        notifyListeners("classicScanState", state);

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("durationMs", activeClassicDurationMs);
        call.resolve(result);
    }

    @PluginMethod
    public void stopClassicDiscovery(PluginCall call) {
        boolean wasScanning = classicReceiver != null;
        stopClassicDiscoveryInternal(true);
        JSObject result = new JSObject();
        result.put("stopped", wasScanning);
        call.resolve(result);
    }

    private void stopClassicDiscoveryInternal(boolean emitComplete) {
        boolean wasScanning = classicReceiver != null;
        if (stopClassicRunnable != null) {
            mainHandler.removeCallbacks(stopClassicRunnable);
            stopClassicRunnable = null;
        }

        BluetoothAdapter adapter = activeClassicAdapter;
        activeClassicAdapter = null;
        if (adapter != null) {
            try {
                if (adapter.isDiscovering()) adapter.cancelDiscovery();
            } catch (SecurityException | RuntimeException ignored) {
                // Android may already have stopped discovery or revoked permission.
            }
        }

        BroadcastReceiver receiver = classicReceiver;
        classicReceiver = null;
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // The receiver can already have been unregistered by Android lifecycle cleanup.
            }
        }

        if (emitComplete && wasScanning) {
            JSObject state = new JSObject();
            state.put("state", "complete");
            state.put("devicesFound", classicSeenAddresses.size());
            state.put("durationMs", activeClassicDurationMs);
            state.put("message", classicSeenAddresses.isEmpty()
                ? "No classic Bluetooth devices were found. Nearby devices must be discoverable during the scan."
                : "Classic Bluetooth discovery finished.");
            notifyListeners("classicScanState", state);
        }
    }

    private void emitClassicScanError(String message) {
        JSObject state = new JSObject();
        state.put("state", "error");
        state.put("message", message);
        notifyListeners("classicScanState", state);
        stopClassicDiscoveryInternal(false);
    }

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
                requestPermissionForAlias("bluetoothConnect", call, "onPairedDevicesConnectPermission");
                return;
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            && getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onPairedDevicesLocationPermission");
            return;
        }

        listPairedDevicesAfterPermissions(call);
    }

    @PermissionCallback
    private void onPairedDevicesConnectPermission(PluginCall call) {
        if (getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("Nearby Devices permission is required to list paired Bluetooth devices.");
            return;
        }
        listPairedDevicesAfterPermissions(call);
    }

    @PermissionCallback
    private void onPairedDevicesLocationPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is required to list paired devices on this Android version.");
            return;
        }
        listPairedDevicesAfterPermissions(call);
    }

    @SuppressLint("MissingPermission")
    private void listPairedDevicesAfterPermissions(PluginCall call) {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        if (adapter == null) {
            call.reject("Android did not provide a Bluetooth adapter.");
            return;
        }

        try {
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth is turned off. Enable Bluetooth in Android Settings and retry.");
                return;
            }

            JSArray devices = new JSArray();
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                if (device == null) continue;
                String address = device.getAddress();
                if (address == null || address.trim().isEmpty()) continue;
                String name = null;
                try {
                    name = device.getName();
                } catch (SecurityException ignored) {
                    // Address and paired state are still useful when Android withholds the name.
                }

                JSObject item = new JSObject();
                item.put("id", address);
                item.put("address", address);
                if (name != null && !name.trim().isEmpty()) {
                    item.put("name", name.replaceAll("[\\p{Cntrl}]", " ").trim());
                }
                item.put("transport", "CLASSIC");
                item.put("source", "REAL");
                item.put("paired", true);
                item.put("bondState", device.getBondState());
                item.put("observedAt", System.currentTimeMillis());
                devices.put(item);
            }

            JSObject result = new JSObject();
            result.put("devices", devices);
            result.put("count", devices.length());
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Android denied access to paired Bluetooth devices. Check Nearby Devices permission.");
        } catch (RuntimeException error) {
            call.reject("Could not list paired Bluetooth devices: " + safeMessage(error));
        }
    }

    @PluginMethod
    public void stopBleScan(PluginCall call) {
        boolean wasScanning = activeScanCallback != null;
        stopBleScanInternal(true);
        JSObject result = new JSObject();
        result.put("stopped", wasScanning);
        call.resolve(result);
    }

    private void stopBleScanInternal(boolean emitComplete) {
        boolean wasScanning = activeScanCallback != null;
        if (stopScanRunnable != null) {
            mainHandler.removeCallbacks(stopScanRunnable);
            stopScanRunnable = null;
        }

        BluetoothLeScanner scanner = activeScanner;
        ScanCallback callback = activeScanCallback;
        activeScanner = null;
        activeScanCallback = null;

        if (scanner != null && callback != null) {
            try {
                scanner.stopScan(callback);
            } catch (SecurityException | IllegalArgumentException ignored) {
                // Permission may have been revoked or Android may have ended the scan.
            }
        }

        if (emitComplete && wasScanning) {
            JSObject state = new JSObject();
            state.put("state", "complete");
            state.put("devicesFound", seenAddresses.size());
            state.put("durationMs", activeDurationMs);
            notifyListeners("scanState", state);
        }
    }

    private String scanFailureMessage(int errorCode) {
        switch (errorCode) {
            case ScanCallback.SCAN_FAILED_ALREADY_STARTED:
                return "Android reports that this BLE scan was already started.";
            case ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED:
                return "Android could not register BlueGuardian for BLE scanning. Retry after a short pause.";
            case ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED:
                return "The Bluetooth hardware or Android build does not support this BLE scan mode.";
            case ScanCallback.SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES:
                return "Bluetooth hardware resources are temporarily unavailable. Stop other scans and retry.";
            case ScanCallback.SCAN_FAILED_SCANNING_TOO_FREQUENTLY:
                return "Android is rate-limiting BLE scans. Wait briefly before retrying.";
            default:
                return "Android BLE scan failed with code " + errorCode + ".";
        }
    }

    private String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
    }

    @Override
    protected void handleOnPause() {
        stopBleScanInternal(true);
        stopClassicDiscoveryInternal(true);
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        stopBleScanInternal(false);
        stopClassicDiscoveryInternal(false);
        super.handleOnDestroy();
    }
}
