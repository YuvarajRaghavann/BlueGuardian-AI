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

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "BlueGuardianBluetooth",
    permissions = {
        @Permission(alias = "bluetoothScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION })
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
    /** Second scan client for Bluetooth 5 extended advertisements (only where the controller supports them). */
    private ScanCallback activeExtendedCallback;
    private Runnable stopScanRunnable;
    private Runnable delayedStartRunnable;
    /** Recently scanned devices, so a follow-up GATT name lookup uses the right LE address type. */
    private final Map<String, BluetoothDevice> scannedDevices = new java.util.LinkedHashMap<String, BluetoothDevice>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, BluetoothDevice> eldest) {
            return size() > 512;
        }
    };
    private boolean resolvingNames;
    private int activeDurationMs = DEFAULT_SCAN_DURATION_MS;

    private BluetoothAdapter activeClassicAdapter;
    private boolean classicDiscoveryOwned;
    private BroadcastReceiver classicReceiver;
    private Runnable stopClassicRunnable;
    private final Set<String> classicSeenAddresses = new HashSet<>();
    private int activeClassicDurationMs = DEFAULT_SCAN_DURATION_MS;
    private final Map<String, String> classicNames = new HashMap<>();
    private boolean locationAsked;
    /** True once Android confirms OUR inquiry started; earlier FINISHED events belong to a cancelled session. */
    private volatile boolean classicStartedSeen;

    @PluginMethod
    public void startBleScan(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // BLUETOOTH_SCAN is not declared neverForLocation, so Android only delivers
            // every advertisement (beacons, earbuds in privacy mode...) when location is
            // also granted. Ask for it in the same prompt; scanning still runs without it.
            if (getPermissionState("bluetoothScan") != PermissionState.GRANTED
                || getPermissionState("bluetoothConnect") != PermissionState.GRANTED
                || (!locationAsked && getPermissionState("location") != PermissionState.GRANTED)) {
                locationAsked = true;
                requestPermissionForAliases(
                    new String[] { "bluetoothScan", "bluetoothConnect", "location" },
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
            call.reject("Allow Nearby devices for BlueGuardian to scan.");
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
                call.reject("Bluetooth is off. Turn it on and scan again.");
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

        Integer requestedDuration = call.getInt("durationMs");
        activeDurationMs = requestedDuration == null
            ? DEFAULT_SCAN_DURATION_MS
            : Math.max(MIN_SCAN_DURATION_MS, Math.min(MAX_SCAN_DURATION_MS, requestedDuration));

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("durationMs", activeDurationMs);
        String warning = visibilityWarning();
        if (warning != null) result.put("warning", warning);

        // A scan is already running (Around, Find and Share can all ask): keep the radio
        // scanning and just restart the window. Stopping and starting again is what makes
        // Android throttle the app, after which it silently delivers NO results at all.
        if (activeScanCallback != null) {
            seenAddresses.clear();
            lastEmittedAt.clear();
            if (stopScanRunnable != null) mainHandler.removeCallbacks(stopScanRunnable);
            stopScanRunnable = () -> stopBleScanInternal(true);
            mainHandler.postDelayed(stopScanRunnable, activeDurationMs);
            result.put("reused", true);
            call.resolve(result);
            return;
        }

        stopBleScanInternal(false);
        seenAddresses.clear();
        lastEmittedAt.clear();

        boolean extendedSupported = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try { extendedSupported = adapter.isLeExtendedAdvertisingSupported(); } catch (RuntimeException ignored) { /* legacy only */ }
        }
        final boolean wantExtended = extendedSupported;
        final int startsNeeded = wantExtended ? 2 : 1;

        // Android allows 5 scan starts per 30 s per app; the 6th is accepted but returns
        // nothing. Wait for a free slot instead of running a scan that can't see anything.
        long delay = ScanBudget.delayFor(startsNeeded);
        if (delay > 0) {
            result.put("startDelayMs", delay);
            final BluetoothLeScanner delayedScanner = scanner;
            delayedStartRunnable = () -> {
                delayedStartRunnable = null;
                String error = startScanners(delayedScanner, wantExtended);
                if (error != null) {
                    JSObject state = new JSObject();
                    state.put("state", "error");
                    state.put("message", error);
                    notifyListeners("scanState", state);
                }
            };
            mainHandler.postDelayed(delayedStartRunnable, delay);
            call.resolve(result);
            return;
        }

        String error = startScanners(scanner, wantExtended);
        if (error != null) {
            call.reject(error);
            return;
        }
        call.resolve(result);
    }

    /** Starts the legacy scan (best for names in scan responses) plus, where supported, an extended scan. */
    @SuppressLint("MissingPermission")
    private String startScanners(BluetoothLeScanner scanner, boolean extended) {
        activeScanner = scanner;
        activeScanCallback = newScanCallback(true);
        try {
            // Plain legacy settings: the most compatible mode across Android 8-16 and every
            // chipset; scan responses (where most devices put their name) are merged reliably.
            ScanSettings legacy = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                .setReportDelay(0)
                .build();
            scanner.startScan(null, legacy, activeScanCallback);
            ScanBudget.record(1);
        } catch (SecurityException error) {
            stopBleScanInternal(false);
            return "Android denied access to Bluetooth scanning. Check Nearby Devices permission.";
        } catch (RuntimeException error) {
            stopBleScanInternal(false);
            return "Android could not start BLE scanning: " + safeMessage(error);
        }

        if (extended && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Bluetooth 5 extended advertisements (newer earbuds, watches, LE Audio). Best effort:
            // a failure here never cancels the legacy scan above.
            try {
                activeExtendedCallback = newScanCallback(false);
                ScanSettings ext = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                    .setLegacy(false)
                    .setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
                    .build();
                scanner.startScan(null, ext, activeExtendedCallback);
                ScanBudget.record(1);
            } catch (RuntimeException ignored) {
                activeExtendedCallback = null;
            }
        }

        stopScanRunnable = () -> stopBleScanInternal(true);
        mainHandler.postDelayed(stopScanRunnable, activeDurationMs);
        JSObject state = new JSObject();
        state.put("state", "scanning");
        state.put("durationMs", activeDurationMs);
        notifyListeners("scanState", state);
        return null;
    }

    private ScanCallback newScanCallback(final boolean primary) {
        return new ScanCallback() {
            private boolean current() {
                return primary ? activeScanCallback == this : activeExtendedCallback == this;
            }

            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (!current()) return;
                emitObservation(result);
            }

            @Override
            public void onBatchScanResults(List<ScanResult> results) {
                if (!current() || results == null) return;
                for (ScanResult result : results) emitObservation(result);
            }

            @Override
            public void onScanFailed(int errorCode) {
                if (!current()) return;
                if (!primary) {
                    // The extended scan is optional; keep the legacy scan running.
                    activeExtendedCallback = null;
                    return;
                }
                JSObject state = new JSObject();
                state.put("state", "error");
                state.put("code", errorCode);
                state.put("message", scanFailureMessage(errorCode));
                notifyListeners("scanState", state);
                stopBleScanInternal(false);
            }
        };
    }

    /**
     * Android's per-app scan limit (5 starts in any 30 s window, enforced silently since
     * Android 7). Shared by every plugin in the app that starts a BLE scan.
     */
    public static final class ScanBudget {
        private static final long WINDOW_MS = 30_000L;
        private static final int MAX_STARTS = 5;
        private static final java.util.ArrayDeque<Long> STARTS = new java.util.ArrayDeque<>();

        private ScanBudget() { }

        /** Milliseconds to wait before {@code starts} more scans can begin without being throttled. */
        public static synchronized long delayFor(int starts) {
            long now = android.os.SystemClock.elapsedRealtime();
            while (!STARTS.isEmpty() && now - STARTS.peekFirst() >= WINDOW_MS) STARTS.pollFirst();
            int free = MAX_STARTS - STARTS.size();
            if (free >= starts) return 0L;
            // The (starts - free)-th oldest start must age out of the window first.
            int index = Math.max(0, starts - free - 1);
            Long[] ordered = STARTS.toArray(new Long[0]);
            long oldest = ordered[Math.min(index, ordered.length - 1)];
            return Math.max(0L, WINDOW_MS - (now - oldest)) + 250L;
        }

        public static synchronized void record(int starts) {
            long now = android.os.SystemClock.elapsedRealtime();
            for (int i = 0; i < starts; i++) STARTS.addLast(now);
            while (STARTS.size() > 32) STARTS.pollFirst();
        }
    }

    /**
     * Android silently hides many scan results when location permission is missing
     * or the phone's Location switch is off. Tell the user instead of showing a short list.
     */
    private String visibilityWarning() {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            return "Some devices are hidden because location is off for BlueGuardian. Allow it in Settings to see everything.";
        }
        try {
            android.location.LocationManager lm = (android.location.LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && !lm.isLocationEnabled()) {
                return "Some devices are hidden because Location is off. Turn it on in quick settings and scan again.";
            }
        } catch (RuntimeException ignored) {
            // best effort
        }
        return null;
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
        scannedDevices.put(address.toUpperCase(java.util.Locale.ROOT), device);
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

        // Raw advertisement payloads let the app identify trackers and pairing-popup
        // spam from their documented formats instead of guessing from names.
        JSObject manufacturerData = new JSObject();
        JSObject serviceData = new JSObject();
        if (record != null) {
            android.util.SparseArray<byte[]> mfg = record.getManufacturerSpecificData();
            if (mfg != null) {
                for (int i = 0; i < mfg.size() && i < 8; i++) {
                    manufacturerData.put(String.format(java.util.Locale.ROOT, "%04x", mfg.keyAt(i) & 0xffff), hexOf(mfg.valueAt(i)));
                }
            }
            java.util.Map<ParcelUuid, byte[]> svc = record.getServiceData();
            if (svc != null) {
                int count = 0;
                for (java.util.Map.Entry<ParcelUuid, byte[]> entry : svc.entrySet()) {
                    if (count++ >= 8) break;
                    serviceData.put(entry.getKey().getUuid().toString().toLowerCase(java.util.Locale.ROOT), hexOf(entry.getValue()));
                }
            }
        }

        JSObject observation = new JSObject();
        observation.put("id", address);
        observation.put("address", address);
        if (name != null) observation.put("name", name);
        observation.put("rssi", result.getRssi());
        observation.put("serviceUuids", serviceUuids);
        observation.put("manufacturerData", manufacturerData);
        observation.put("serviceData", serviceData);
        if (record != null && record.getTxPowerLevel() != Integer.MIN_VALUE) {
            observation.put("txPower", record.getTxPowerLevel());
        }
        observation.put("observedAt", now);
        observation.put("transport", "BLE");
        observation.put("source", "REAL");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            observation.put("connectable", result.isConnectable());
        }
        // Raw advertisement bytes and address type feed the pre-connection Guardian check.
        if (record != null && record.getBytes() != null) observation.put("rawAdvert", hexOf(record.getBytes()));
        Integer addressType = addressTypeOf(device);
        if (addressType != null) observation.put("addressType", addressType == 0 ? "public" : "random");
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
                || getPermissionState("bluetoothConnect") != PermissionState.GRANTED
                || getPermissionState("location") != PermissionState.GRANTED) {
                requestPermissionForAliases(
                    new String[] { "bluetoothScan", "bluetoothConnect", "location" },
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
            || getPermissionState("bluetoothConnect") != PermissionState.GRANTED
            || getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Allow location for BlueGuardian to find earbuds and speakers nearby.");
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
                call.reject("Bluetooth is off. Turn it on and scan again.");
                return;
            }
        } catch (SecurityException error) {
            call.reject("BlueGuardian cannot read Bluetooth state. Grant Nearby Devices permission and retry.");
            return;
        }

        // Stop only a discovery session owned by this plugin. Do not cancel
        // another app's active discovery session behind the user's back.
        stopClassicDiscoveryInternal(false);
        try {
            // A leftover inquiry (our own finder, the system, another app) blocks a fresh
            // one. Android's own Bluetooth settings cancel and restart it, so do the same.
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
        } catch (SecurityException error) {
            call.reject("Android denied the classic discovery state check. Check Nearby Devices permission.");
            return;
        }

        classicSeenAddresses.clear();
        classicNames.clear();
        classicStartedSeen = false;
        Integer requestedDuration = call.getInt("durationMs");
        activeClassicDurationMs = requestedDuration == null
            ? DEFAULT_SCAN_DURATION_MS
            : Math.max(MIN_SCAN_DURATION_MS, Math.min(MAX_SCAN_DURATION_MS, requestedDuration));
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothDevice.ACTION_NAME_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);

        classicReceiver = new BroadcastReceiver() {
            @Override
            @SuppressLint("MissingPermission")
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) return;
                String action = intent.getAction();

                if (BluetoothDevice.ACTION_FOUND.equals(action) || BluetoothDevice.ACTION_NAME_CHANGED.equals(action)) {
                    boolean nameUpdate = BluetoothDevice.ACTION_NAME_CHANGED.equals(action);
                    BluetoothDevice device;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
                    } else {
                        device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    }
                    if (device == null) return;

                    short rssiValue = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                    String address;
                    String name = null;
                    int deviceType;
                    try {
                        address = device.getAddress();
                        name = device.getName();
                        if (name == null || name.trim().isEmpty()) name = intent.getStringExtra(BluetoothDevice.EXTRA_NAME);
                        deviceType = device.getType();
                    } catch (SecurityException error) {
                        emitClassicScanError("Android denied access to classic Bluetooth device details. Check Nearby Devices permission.");
                        return;
                    }
                    if (address == null || address.trim().isEmpty()) return;
                    // Android's discovery also runs an LE inquiry and resolves names for LE
                    // devices the plain BLE scan may only see nameless. Keep them, marked LE.
                    boolean leOnly = deviceType == BluetoothDevice.DEVICE_TYPE_LE;
                    if (leOnly) scannedDevices.put(address.toUpperCase(java.util.Locale.ROOT), device);
                    // Classic inquiry often reports a device first without its name and resolves
                    // the name a moment later. Re-send the device once its name is known so the
                    // list shows "Galaxy Buds2" instead of "name unavailable".
                    String cleanName = name == null ? null : name.replaceAll("[\\p{Cntrl}]", " ").trim();
                    if (cleanName != null && cleanName.isEmpty()) cleanName = null;
                    boolean firstSighting = classicSeenAddresses.add(address);
                    String knownName = classicNames.get(address);
                    boolean nameIsNew = cleanName != null && !cleanName.equals(knownName);
                    if (!firstSighting && !nameIsNew) return;
                    if (nameUpdate && firstSighting) {
                        // A name update for a device inquiry has not found: not a nearby result.
                        classicSeenAddresses.remove(address);
                        return;
                    }
                    if (cleanName != null) classicNames.put(address, cleanName);

                    JSObject observation = new JSObject();
                    observation.put("id", address);
                    observation.put("address", address);
                    if (cleanName != null) {
                        observation.put("name", cleanName);
                    }
                    if (rssiValue != Short.MIN_VALUE) observation.put("rssi", (int) rssiValue);
                    observation.put("transport", "CLASSIC");
                    if (leOnly) observation.put("leOnly", true);
                    observation.put("source", "REAL");
                    observation.put("paired", device.getBondState() == BluetoothDevice.BOND_BONDED);
                    observation.put("observedAt", System.currentTimeMillis());
                    // Class of Device: what the device says it is (audio, keyboard, phone...), used by the Guardian check.
                    try {
                        android.bluetooth.BluetoothClass cod = device.getBluetoothClass();
                        if (cod != null) {
                            observation.put("deviceClass", cod.getDeviceClass());
                            observation.put("majorClass", cod.getMajorDeviceClass());
                        }
                    } catch (SecurityException ignored) {
                        // class of device withheld; the check reports "not declared"
                    }
                    notifyListeners("classicDeviceFound", observation);
                    return;
                }

                if (BluetoothAdapter.ACTION_DISCOVERY_STARTED.equals(action)) {
                    classicStartedSeen = true;
                    JSObject state = new JSObject();
                    state.put("state", "scanning");
                    state.put("message", "Classic Bluetooth discovery started.");
                    notifyListeners("classicScanState", state);
                    return;
                }

                if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                    // Ignore the FINISHED of a session we cancelled just before starting ours.
                    if (!classicStartedSeen) return;
                    // The system session has ended; cleanup must not cancel a new
                    // discovery session that another app might start immediately after it.
                    classicDiscoveryOwned = false;
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
            // Android shares one adapter-wide classic inquiry session. If another
            // app starts discovery after our first check, do not cancel its session.
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
            boolean started = adapter.startDiscovery();
            if (!started) {
                // The adapter can need a moment after cancelDiscovery(); retry once.
                try { Thread.sleep(400); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                started = adapter.startDiscovery();
            }
            if (!started) {
                int adapterState = adapter.getState();
                boolean anotherDiscoveryActive = adapter.isDiscovering();
                stopClassicDiscoveryInternal(false);
                if (adapterState != BluetoothAdapter.STATE_ON) {
                    call.reject("Bluetooth is not fully ready. Turn Bluetooth on, wait a few seconds, and retry classic discovery.");
                } else if (anotherDiscoveryActive) {
                    call.reject("Another classic Bluetooth discovery session is active. Wait briefly and retry.");
                } else {
                    call.reject("Android's Bluetooth service rejected classic discovery. Bluetooth may be temporarily unavailable; wait briefly, then retry.");
                }
                return;
            }
            activeClassicAdapter = adapter;
            classicDiscoveryOwned = true;
        } catch (SecurityException error) {
            stopClassicDiscoveryInternal(false);
            call.reject("Android denied classic Bluetooth discovery. Check Nearby Devices and Location permissions.");
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
        String warning = visibilityWarning();
        if (warning != null) result.put("warning", warning);
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

        boolean ownsDiscovery = classicDiscoveryOwned;
        classicDiscoveryOwned = false;
        BluetoothAdapter adapter = activeClassicAdapter;
        activeClassicAdapter = null;
        if (adapter != null && ownsDiscovery) {
            try {
                if (adapter.isDiscovering()) adapter.cancelDiscovery();
            } catch (RuntimeException ignored) {
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetoothConnect", call, "onPairedDevicesConnectPermission");
            return;
        }

        // On Android 11 and older, the app's manifest already declares legacy
        // BLUETOOTH permission. A location grant is needed for discovery, not
        // merely reading the system's bonded-device list.
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
                call.reject("Bluetooth is off. Turn it on and scan again.");
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
                item.put("transport", "PAIRED");
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

    @SuppressLint("MissingPermission")
    private void stopBleScanInternal(boolean emitComplete) {
        boolean wasScanning = activeScanCallback != null || delayedStartRunnable != null;
        if (stopScanRunnable != null) {
            mainHandler.removeCallbacks(stopScanRunnable);
            stopScanRunnable = null;
        }
        if (delayedStartRunnable != null) {
            mainHandler.removeCallbacks(delayedStartRunnable);
            delayedStartRunnable = null;
        }

        BluetoothLeScanner scanner = activeScanner;
        ScanCallback callback = activeScanCallback;
        ScanCallback extendedCallback = activeExtendedCallback;
        activeScanner = null;
        activeScanCallback = null;
        activeExtendedCallback = null;

        if (scanner != null) {
            for (ScanCallback cb : new ScanCallback[] { callback, extendedCallback }) {
                if (cb == null) continue;
                try {
                    scanner.stopScan(cb);
                } catch (RuntimeException ignored) {
                    // Permission may have been revoked, the adapter turned off, or Android ended the scan.
                }
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

    // ------------------------------------------------------------ name lookup

    private static final UUID GAP_SERVICE = UUID.fromString("00001800-0000-1000-8000-00805f9b34fb");
    private static final UUID GAP_DEVICE_NAME = UUID.fromString("00002a00-0000-1000-8000-00805f9b34fb");
    private static final UUID GAP_APPEARANCE = UUID.fromString("00002a01-0000-1000-8000-00805f9b34fb");
    private static final UUID DIS_SERVICE = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb");
    private static final UUID DIS_MANUFACTURER = UUID.fromString("00002a29-0000-1000-8000-00805f9b34fb");
    private static final UUID DIS_MODEL = UUID.fromString("00002a24-0000-1000-8000-00805f9b34fb");
    private static final int MAX_NAME_LOOKUPS = 12;

    /**
     * Many phones (every iPhone, most new Android phones) and accessories advertise
     * without a name; the name lives in the GAP "Device Name" characteristic. For each
     * nameless, connectable device the app asks about, connect briefly WITHOUT pairing,
     * read Device Name / Appearance / maker / model, and disconnect. Nothing is written.
     * Results stream as "nameResolved" events; the call resolves when all are done.
     */
    @PluginMethod
    public void resolveNames(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("Allow Nearby devices for BlueGuardian to identify devices.");
            return;
        }
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        final BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        if (adapter == null) {
            call.reject("Android did not provide a Bluetooth adapter.");
            return;
        }
        if (resolvingNames) {
            call.reject("Already identifying devices.");
            return;
        }
        JSArray requested = call.getArray("addresses");
        final java.util.ArrayDeque<String> queue = new java.util.ArrayDeque<>();
        if (requested != null) {
            for (int i = 0; i < requested.length() && queue.size() < MAX_NAME_LOOKUPS; i++) {
                String a = requested.optString(i, "").trim().toUpperCase(java.util.Locale.ROOT);
                if (BluetoothAdapter.checkBluetoothAddress(a) && !queue.contains(a)) queue.add(a);
            }
        }
        Integer perDevice = call.getInt("timeoutMs", 5000);
        final int timeoutMs = Math.max(2500, Math.min(9000, perDevice == null ? 5000 : perDevice));
        final int[] resolved = { 0 };
        resolvingNames = true;
        final Runnable[] next = new Runnable[1];
        next[0] = () -> {
            String address = queue.poll();
            if (address == null) {
                resolvingNames = false;
                JSObject out = new JSObject();
                out.put("resolved", resolved[0]);
                call.resolve(out);
                return;
            }
            BluetoothDevice device = scannedDevices.get(address);
            try {
                if (device == null) device = adapter.getRemoteDevice(address);
            } catch (IllegalArgumentException error) {
                mainHandler.post(next[0]);
                return;
            }
            lookUpName(device, address, timeoutMs, (found) -> {
                if (found) resolved[0]++;
                // Give the controller a breath between connections.
                mainHandler.postDelayed(next[0], 150);
            });
        };
        mainHandler.post(next[0]);
    }

    private interface LookupDone { void done(boolean found); }

    @SuppressLint("MissingPermission")
    private void lookUpName(final BluetoothDevice device, final String address, int timeoutMs, final LookupDone done) {
        final JSObject event = new JSObject();
        event.put("address", address);
        final boolean[] finished = { false };
        final android.bluetooth.BluetoothGatt[] gattRef = new android.bluetooth.BluetoothGatt[1];
        final java.util.ArrayDeque<android.bluetooth.BluetoothGattCharacteristic> reads = new java.util.ArrayDeque<>();

        final Runnable finish = () -> {
            if (finished[0]) return;
            finished[0] = true;
            android.bluetooth.BluetoothGatt gatt = gattRef[0];
            if (gatt != null) {
                try { gatt.disconnect(); } catch (RuntimeException ignored) { /* already gone */ }
                try { gatt.close(); } catch (RuntimeException ignored) { /* already gone */ }
            }
            boolean found = event.has("name") || event.has("manufacturer") || event.has("model");
            event.put("ok", found);
            notifyListeners("nameResolved", event);
            done.done(found);
        };
        mainHandler.postDelayed(finish, timeoutMs);

        android.bluetooth.BluetoothGattCallback callback = new android.bluetooth.BluetoothGattCallback() {
            private void readNext(android.bluetooth.BluetoothGatt gatt) {
                while (!reads.isEmpty()) {
                    try {
                        if (gatt.readCharacteristic(reads.poll())) return;
                    } catch (RuntimeException ignored) { /* skip this one */ }
                }
                mainHandler.post(finish);
            }

            @Override
            public void onConnectionStateChange(android.bluetooth.BluetoothGatt gatt, int status, int newState) {
                if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
                    try {
                        if (!gatt.discoverServices()) mainHandler.post(finish);
                    } catch (RuntimeException error) {
                        mainHandler.post(finish);
                    }
                } else if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
                    mainHandler.post(finish);
                }
            }

            @Override
            public void onServicesDiscovered(android.bluetooth.BluetoothGatt gatt, int status) {
                android.bluetooth.BluetoothGattService gap = gatt.getService(GAP_SERVICE);
                android.bluetooth.BluetoothGattService dis = gatt.getService(DIS_SERVICE);
                if (gap != null) {
                    android.bluetooth.BluetoothGattCharacteristic n = gap.getCharacteristic(GAP_DEVICE_NAME);
                    android.bluetooth.BluetoothGattCharacteristic a = gap.getCharacteristic(GAP_APPEARANCE);
                    if (n != null) reads.add(n);
                    if (a != null) reads.add(a);
                }
                if (dis != null) {
                    android.bluetooth.BluetoothGattCharacteristic m = dis.getCharacteristic(DIS_MANUFACTURER);
                    android.bluetooth.BluetoothGattCharacteristic md = dis.getCharacteristic(DIS_MODEL);
                    if (m != null) reads.add(m);
                    if (md != null) reads.add(md);
                }
                readNext(gatt);
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onCharacteristicRead(android.bluetooth.BluetoothGatt gatt, android.bluetooth.BluetoothGattCharacteristic c, int status) {
                handle(gatt, c, c.getValue(), status);
            }

            @Override
            public void onCharacteristicRead(android.bluetooth.BluetoothGatt gatt, android.bluetooth.BluetoothGattCharacteristic c, byte[] value, int status) {
                handle(gatt, c, value, status);
            }

            private void handle(android.bluetooth.BluetoothGatt gatt, android.bluetooth.BluetoothGattCharacteristic c, byte[] value, int status) {
                if (status == android.bluetooth.BluetoothGatt.GATT_SUCCESS && value != null && value.length > 0) {
                    UUID id = c.getUuid();
                    if (GAP_APPEARANCE.equals(id) && value.length >= 2) {
                        event.put("appearance", (value[0] & 0xff) | ((value[1] & 0xff) << 8));
                    } else {
                        String text = new String(value, StandardCharsets.UTF_8).replaceAll("[\\p{Cntrl}]", " ").trim();
                        if (text.length() > 96) text = text.substring(0, 96);
                        if (!text.isEmpty()) {
                            if (GAP_DEVICE_NAME.equals(id)) event.put("name", text);
                            else if (DIS_MANUFACTURER.equals(id)) event.put("manufacturer", text);
                            else if (DIS_MODEL.equals(id)) event.put("model", text);
                        }
                    }
                }
                readNext(gatt);
            }
        };

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                gattRef[0] = device.connectGatt(getContext(), false, callback, BluetoothDevice.TRANSPORT_LE);
            } else {
                gattRef[0] = device.connectGatt(getContext(), false, callback);
            }
            if (gattRef[0] == null) mainHandler.post(finish);
        } catch (RuntimeException error) {
            mainHandler.post(finish);
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

    /** BluetoothDevice.getAddressType() exists on newer Android; read it reflectively and fall back to null. */
    private static Integer addressTypeOf(BluetoothDevice device) {
        try {
            java.lang.reflect.Method m = device.getClass().getMethod("getAddressType");
            Object v = m.invoke(device);
            return v instanceof Integer ? (Integer) v : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String hexOf(byte[] data) {
        if (data == null) return "";
        int n = Math.min(data.length, 64);
        StringBuilder out = new StringBuilder(n * 2);
        for (int i = 0; i < n; i++) out.append(String.format(java.util.Locale.ROOT, "%02x", data[i] & 0xff));
        return out.toString();
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
