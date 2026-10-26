package com.blueguardian.hybrid;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * "My devices" support for BlueGuardian:
 *  - lists paired devices WITH their live connection state (connected earbuds stop
 *    advertising, so a scan alone never shows them),
 *  - pairs / connects a device, falling back to Android Bluetooth settings,
 *  - live "find it" signal meter (BLE + classic inquiry RSSI),
 *  - last-seen time and place per device (see BlueGuardianPresenceReceiver),
 *  - phone location, share sheet and map opening for lost-device sharing.
 */
@CapacitorPlugin(
    name = "BlueGuardianDevices",
    permissions = {
        @Permission(alias = "bluetoothScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
    }
)
public class BlueGuardianDevicesPlugin extends Plugin {
    private static final int[] AUDIO_PROFILES = { BluetoothProfile.A2DP, BluetoothProfile.HEADSET };
    private static final int PROFILE_HEARING_AID = 21;
    private static final int PROFILE_LE_AUDIO = 22;

    private final Map<Integer, BluetoothProfile> proxies = new ConcurrentHashMap<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver liveReceiver;

    // pair & connect
    /** GATT links opened for BLE-only gadgets; kept open while the app runs, like a companion app. */
    private final Map<String, android.bluetooth.BluetoothGatt> gattLinks = new ConcurrentHashMap<>();
    /** A "Pair & connect" call waiting for the user to accept Android's pairing prompt. */
    private volatile PluginCall pendingPair;
    private volatile String pendingPairAddress;
    private Runnable pendingPairTimeout;

    // proximity finder
    private ScanCallback proximityCallback;
    private BroadcastReceiver proximityClassicReceiver;
    private String proximityAddress;
    private Runnable proximityStop;
    private Runnable classicRestart;

    @Override
    public void load() {
        // Forward connect/disconnect events while the app is open so the UI updates instantly.
        liveReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device == null) return;
                if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(intent.getAction())) {
                    int state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                    JSObject bond = new JSObject();
                    try {
                        bond.put("address", device.getAddress());
                        String n = device.getName();
                        if (n != null) bond.put("name", n);
                    } catch (SecurityException error) {
                        return;
                    }
                    bond.put("paired", state == BluetoothDevice.BOND_BONDED);
                    bond.put("bonding", state == BluetoothDevice.BOND_BONDING);
                    bond.put("at", System.currentTimeMillis());
                    notifyListeners("bond", bond);
                    onBondChanged(device, state);
                    return;
                }
                JSObject event = new JSObject();
                try {
                    event.put("address", device.getAddress());
                    String name = device.getName();
                    if (name != null) event.put("name", name);
                } catch (SecurityException error) {
                    return;
                }
                event.put("connected", BluetoothDevice.ACTION_ACL_CONNECTED.equals(intent.getAction()));
                event.put("at", System.currentTimeMillis());
                notifyListeners("presence", event);
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
        filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                getContext().registerReceiver(liveReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(liveReceiver, filter);
            }
        } catch (Exception ignored) {
            liveReceiver = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopProximityInternal();
        for (android.bluetooth.BluetoothGatt g : gattLinks.values()) {
            try { g.disconnect(); g.close(); } catch (Exception ignored) { /* ignore */ }
        }
        gattLinks.clear();
        if (liveReceiver != null) {
            try { getContext().unregisterReceiver(liveReceiver); } catch (Exception ignored) { /* already gone */ }
        }
        BluetoothAdapter adapter = adapter();
        if (adapter != null) {
            for (Map.Entry<Integer, BluetoothProfile> e : proxies.entrySet()) {
                try { adapter.closeProfileProxy(e.getKey(), e.getValue()); } catch (Exception ignored) { /* ignore */ }
            }
        }
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------ permissions

    private boolean granted(String alias) {
        return getPermissionState(alias) == PermissionState.GRANTED;
    }

    private boolean locationAsked;

    private boolean ensureBluetooth(PluginCall call, boolean scan) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean ok = granted("bluetoothConnect") && (!scan || granted("bluetoothScan"));
            // Scan results (the "Find it" signal meter) are only delivered with location granted,
            // because BLUETOOTH_SCAN is not declared neverForLocation. Ask once, never require it.
            boolean wantLocation = scan && !locationAsked && !granted("location");
            if (ok && !wantLocation) return true;
            String[] aliases = scan
                ? (wantLocation ? new String[] { "bluetoothScan", "bluetoothConnect", "location" } : new String[] { "bluetoothScan", "bluetoothConnect" })
                : new String[] { "bluetoothConnect" };
            if (wantLocation) locationAsked = true;
            requestPermissionForAliases(aliases, call, "onBluetoothPermission");
            return false;
        }
        if (scan && !granted("location")) {
            requestPermissionForAlias("location", call, "onBluetoothPermission");
            return false;
        }
        return true;
    }

    /** Onboarding: ask for Nearby Devices (scan + connect) up front. Resolves { granted }. */
    @PluginMethod
    public void requestBluetooth(PluginCall call) {
        if (!ensureBluetooth(call, true)) return;
        JSObject out = new JSObject();
        out.put("granted", true);
        call.resolve(out);
    }

    @PluginMethod
    public void bluetoothStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? granted("bluetoothScan") && granted("bluetoothConnect")
            : granted("location"));
        call.resolve(out);
    }

    @PermissionCallback
    private void onBluetoothPermission(PluginCall call) {
        if ("requestBluetooth".equals(call.getMethodName())) {
            JSObject out = new JSObject();
            out.put("granted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? granted("bluetoothScan") && granted("bluetoothConnect")
                : granted("location"));
            call.resolve(out);
            return;
        }
        boolean ok = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? granted("bluetoothConnect") : true;
        if (!ok) {
            call.reject("Allow Nearby devices for BlueGuardian, then try again.");
            return;
        }
        switch (call.getMethodName()) {
            case "listKnownDevices": listKnownDevices(call); break;
            case "connect": connect(call); break;
            case "startProximity": startProximity(call); break;
            default: call.resolve();
        }
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager != null ? manager.getAdapter() : null;
    }

    private BluetoothAdapter usableAdapter(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This phone does not have Bluetooth.");
            return null;
        }
        try {
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth is off. Turn it on and try again.");
                return null;
            }
        } catch (SecurityException error) {
            call.reject("Allow Nearby devices for BlueGuardian, then try again.");
            return null;
        }
        return adapter;
    }

    /** Opens A2DP / headset / hearing-aid / LE-audio proxies once and waits briefly for them. */
    private void ensureProxies(BluetoothAdapter adapter) {
        List<Integer> wanted = new ArrayList<>();
        wanted.add(BluetoothProfile.A2DP);
        wanted.add(BluetoothProfile.HEADSET);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) wanted.add(PROFILE_HEARING_AID);
        if (Build.VERSION.SDK_INT >= 33) wanted.add(PROFILE_LE_AUDIO);
        List<Integer> missing = new ArrayList<>();
        for (Integer p : wanted) if (!proxies.containsKey(p)) missing.add(p);
        if (missing.isEmpty()) return;
        final CountDownLatch latch = new CountDownLatch(missing.size());
        for (Integer profile : missing) {
            boolean requested;
            try {
                requested = adapter.getProfileProxy(getContext(), new BluetoothProfile.ServiceListener() {
                    @Override
                    public void onServiceConnected(int p, BluetoothProfile proxy) {
                        proxies.put(p, proxy);
                        latch.countDown();
                    }

                    @Override
                    public void onServiceDisconnected(int p) {
                        proxies.remove(p);
                    }
                }, profile);
            } catch (Exception error) {
                requested = false;
            }
            if (!requested) latch.countDown();
        }
        try {
            latch.await(2000, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private static String profileName(int profile) {
        switch (profile) {
            case BluetoothProfile.A2DP: return "audio";
            case BluetoothProfile.HEADSET: return "calls";
            case PROFILE_HEARING_AID: return "hearing aid";
            case PROFILE_LE_AUDIO: return "LE audio";
            case BluetoothProfile.GATT: return "BLE";
            default: return "profile " + profile;
        }
    }

    @SuppressLint("MissingPermission")
    private Map<String, List<String>> connectedProfiles(BluetoothAdapter adapter) {
        Map<String, List<String>> out = new HashMap<>();
        for (Map.Entry<Integer, BluetoothProfile> e : proxies.entrySet()) {
            try {
                for (BluetoothDevice d : e.getValue().getConnectedDevices()) {
                    String key = d.getAddress().toUpperCase(Locale.ROOT);
                    List<String> list = out.get(key);
                    if (list == null) { list = new ArrayList<>(); out.put(key, list); }
                    list.add(profileName(e.getKey()));
                }
            } catch (Exception ignored) {
                // proxy died or permission missing
            }
        }
        try {
            BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            if (manager != null) {
                for (BluetoothDevice d : manager.getConnectedDevices(BluetoothProfile.GATT)) {
                    String key = d.getAddress().toUpperCase(Locale.ROOT);
                    List<String> list = out.get(key);
                    if (list == null) { list = new ArrayList<>(); out.put(key, list); }
                    list.add("BLE");
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
        return out;
    }

    /** Hidden but long-standing API; used only as an extra signal and never required. */
    private static boolean reflectIsConnected(BluetoothDevice device) {
        try {
            Method m = device.getClass().getMethod("isConnected");
            Object r = m.invoke(device);
            return r instanceof Boolean && (Boolean) r;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static String category(BluetoothClass cls) {
        if (cls == null) return "other";
        switch (cls.getMajorDeviceClass()) {
            case BluetoothClass.Device.Major.AUDIO_VIDEO: return "audio";
            case BluetoothClass.Device.Major.WEARABLE: return "wearable";
            case BluetoothClass.Device.Major.PHONE: return "phone";
            case BluetoothClass.Device.Major.COMPUTER: return "computer";
            case BluetoothClass.Device.Major.PERIPHERAL: return "input";
            case BluetoothClass.Device.Major.HEALTH: return "health";
            default: return "other";
        }
    }

    private static String typeName(int type) {
        switch (type) {
            case BluetoothDevice.DEVICE_TYPE_CLASSIC: return "CLASSIC";
            case BluetoothDevice.DEVICE_TYPE_LE: return "LE";
            case BluetoothDevice.DEVICE_TYPE_DUAL: return "DUAL";
            default: return "UNKNOWN";
        }
    }

    @SuppressLint("MissingPermission")
    private JSObject describe(BluetoothDevice d, Map<String, List<String>> connected) {
        JSObject o = new JSObject();
        String address = d.getAddress().toUpperCase(Locale.ROOT);
        o.put("address", address);
        String name = null;
        try { name = d.getName(); } catch (SecurityException ignored) { /* withheld */ }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                String alias = d.getAlias();
                if (alias != null && !alias.trim().isEmpty()) name = alias;
            } catch (SecurityException ignored) { /* withheld */ }
        }
        if (name != null) o.put("name", name.trim());
        try { o.put("type", typeName(d.getType())); } catch (SecurityException ignored) { o.put("type", "UNKNOWN"); }
        try {
            BluetoothClass cls = d.getBluetoothClass();
            o.put("category", category(cls));
            if (cls != null) {
                o.put("deviceClass", cls.getDeviceClass());
                o.put("majorClass", cls.getMajorDeviceClass());
            }
        } catch (SecurityException ignored) { o.put("category", "other"); }
        int bond = BluetoothDevice.BOND_NONE;
        try { bond = d.getBondState(); } catch (SecurityException ignored) { /* withheld */ }
        o.put("paired", bond == BluetoothDevice.BOND_BONDED);
        List<String> profiles = connected.get(address);
        boolean isConnected = (profiles != null && !profiles.isEmpty()) || reflectIsConnected(d);
        o.put("connected", isConnected);
        JSArray p = new JSArray();
        if (profiles != null) for (String s : profiles) p.put(s);
        o.put("profiles", p);
        return o;
    }

    // ------------------------------------------------------------- devices

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void listKnownDevices(PluginCall call) {
        if (!ensureBluetooth(call, false)) return;
        BluetoothAdapter adapter = usableAdapter(call);
        if (adapter == null) return;
        ensureProxies(adapter);
        Map<String, List<String>> connected = connectedProfiles(adapter);
        Map<String, JSObject> out = new LinkedHashMap<>();
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) for (BluetoothDevice d : bonded) out.put(d.getAddress().toUpperCase(Locale.ROOT), describe(d, connected));
            for (String address : connected.keySet()) {
                if (!out.containsKey(address)) out.put(address, describe(adapter.getRemoteDevice(address), connected));
            }
        } catch (SecurityException error) {
            call.reject("Allow Nearby devices for BlueGuardian, then try again.");
            return;
        }
        JSONObject lastSeen = BlueGuardianPresenceReceiver.LastSeenStore.readAll(getContext());
        JSArray devices = new JSArray();
        for (JSObject d : out.values()) {
            String address = d.getString("address");
            if (d.getBool("connected") != null && d.getBool("connected")) {
                BlueGuardianPresenceReceiver.LastSeenStore.recordSighting(getContext(), address, d.getString("name"), "connected", null);
            }
            JSONObject seen = lastSeen.optJSONObject(address);
            if (seen != null) d.put("lastSeen", seen);
            devices.put(d);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void getLastSeen(PluginCall call) {
        JSObject result = new JSObject();
        result.put("entries", BlueGuardianPresenceReceiver.LastSeenStore.readAll(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void forgetLastSeen(PluginCall call) {
        String address = call.getString("address");
        if (address != null) BlueGuardianPresenceReceiver.LastSeenStore.forget(getContext(), address);
        call.resolve();
    }

    /**
     * Pair (unpaired) or connect (paired) a device, end to end:
     *  - BLE-only gadgets: open a GATT link (that IS the connection) and report when it is up.
     *  - Classic / dual devices that are not paired: start pairing, wait for the user to accept
     *    Android's prompt, then wait for the audio/input profiles Android connects after pairing.
     *  - Paired devices: ask the profiles to connect where Android still allows it, otherwise
     *    nudge the link and fall back to Bluetooth settings in one tap.
     * result: "connected" | "paired" | "pairing" | "requested" | "settings"
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(PluginCall call) {
        if (!ensureBluetooth(call, true)) return;
        BluetoothAdapter adapter = usableAdapter(call);
        if (adapter == null) return;
        String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address.toUpperCase(Locale.ROOT))) {
            call.reject("This device has no usable Bluetooth address.");
            return;
        }
        final BluetoothDevice device = adapter.getRemoteDevice(address.toUpperCase(Locale.ROOT));
        // An inquiry in progress makes pairing and connecting slow or fail; Android Settings stops it too.
        try {
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
        } catch (SecurityException ignored) { /* continue */ }

        int bond;
        int type;
        try {
            bond = device.getBondState();
            type = device.getType();
        } catch (SecurityException error) {
            call.reject("Allow Nearby devices for BlueGuardian, then try again.");
            return;
        }

        ensureProxies(adapter);
        if (isConnectedNow(adapter, device)) {
            JSObject out = new JSObject();
            out.put("result", "connected");
            out.put("message", "Already connected.");
            call.resolve(out);
            return;
        }

        // BLE-only gadgets (tags, bands, sensors): a GATT link is the connection; no pairing needed.
        if (type == BluetoothDevice.DEVICE_TYPE_LE && bond != BluetoothDevice.BOND_BONDED) {
            connectGattLink(call, device);
            return;
        }

        if (bond == BluetoothDevice.BOND_BONDING) {
            waitForPairing(call, device);
            return;
        }
        if (bond == BluetoothDevice.BOND_NONE) {
            boolean started;
            try { started = device.createBond(); } catch (SecurityException error) { started = false; }
            if (!started) {
                JSObject out = new JSObject();
                out.put("result", "settings");
                out.put("message", "Pairing didn't start. Put the device in pairing mode and try again.");
                call.resolve(out);
                return;
            }
            waitForPairing(call, device);
            return;
        }

        connectBonded(call, adapter, device, type);
    }

    /** Keeps the call open until the user accepts (or rejects) Android's pairing prompt. */
    private void waitForPairing(PluginCall call, BluetoothDevice device) {
        clearPendingPair("Another pairing request replaced this one.");
        call.setKeepAlive(true);
        pendingPair = call;
        pendingPairAddress = device.getAddress().toUpperCase(Locale.ROOT);
        pendingPairTimeout = () -> {
            PluginCall pending = pendingPair;
            if (pending == null) return;
            resetPendingPair();
            JSObject out = new JSObject();
            out.put("result", "pairing");
            out.put("message", "Still waiting. Accept the pairing request on screen.");
            resolveKeptAlive(pending, out);
        };
        mainHandler.postDelayed(pendingPairTimeout, 45000);
        JSObject progress = new JSObject();
        progress.put("address", pendingPairAddress);
        progress.put("bonding", true);
        progress.put("paired", false);
        progress.put("at", System.currentTimeMillis());
        notifyListeners("bond", progress);
        // "Just works" pairing can finish before we start listening; don't wait 45 s for it.
        try {
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) mainHandler.post(() -> onBondChanged(device, BluetoothDevice.BOND_BONDED));
        } catch (SecurityException ignored) { /* the broadcast will arrive */ }
    }

    /** Called from the bond-state broadcast. */
    @SuppressLint("MissingPermission")
    private void onBondChanged(BluetoothDevice device, int state) {
        PluginCall pending = pendingPair;
        if (pending == null || pendingPairAddress == null) return;
        String address;
        try { address = device.getAddress().toUpperCase(Locale.ROOT); } catch (SecurityException e) { return; }
        if (!pendingPairAddress.equals(address)) return;
        if (state == BluetoothDevice.BOND_BONDING) return;
        resetPendingPair();
        if (state == BluetoothDevice.BOND_NONE) {
            JSObject out = new JSObject();
            out.put("result", "settings");
            out.put("message", "Pairing was cancelled. Put the device in pairing mode and try again.");
            resolveKeptAlive(pending, out);
            return;
        }
        // Paired. Android connects audio / keyboard profiles by itself right after pairing;
        // wait for that so the user sees "Connected" exactly like the system screen.
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            JSObject out = new JSObject();
            out.put("result", "paired");
            out.put("message", "Paired.");
            resolveKeptAlive(pending, out);
            return;
        }
        int type;
        try { type = device.getType(); } catch (SecurityException e) { type = BluetoothDevice.DEVICE_TYPE_UNKNOWN; }
        final int deviceType = type;
        // Off the main thread: opening profile proxies waits for main-thread callbacks.
        getBridge().execute(() -> connectBonded(pending, adapter, device, deviceType));
    }

    private void resetPendingPair() {
        if (pendingPairTimeout != null) mainHandler.removeCallbacks(pendingPairTimeout);
        pendingPairTimeout = null;
        pendingPair = null;
        pendingPairAddress = null;
    }

    private void clearPendingPair(String reason) {
        PluginCall pending = pendingPair;
        if (pending == null) return;
        resetPendingPair();
        JSObject out = new JSObject();
        out.put("result", "pairing");
        out.put("message", reason);
        resolveKeptAlive(pending, out);
    }

    private void resolveKeptAlive(PluginCall call, JSObject out) {
        try { call.resolve(out); } finally {
            try { call.setKeepAlive(false); getBridge().releaseCall(call); } catch (Exception ignored) { /* already released */ }
        }
    }

    /** Paired device that is not connected: ask Android, then poll until it is (or give up kindly). */
    @SuppressLint("MissingPermission")
    private void connectBonded(PluginCall call, BluetoothAdapter adapter, BluetoothDevice device, int type) {
        ensureProxies(adapter);
        boolean asked = false;
        for (int profile : AUDIO_PROFILES) {
            BluetoothProfile proxy = proxies.get(profile);
            if (proxy == null) continue;
            try {
                Method m = proxy.getClass().getMethod("connect", BluetoothDevice.class);
                Object r = m.invoke(proxy, device);
                if (r instanceof Boolean && (Boolean) r) asked = true;
            } catch (Throwable ignored) {
                // Android 12+ reserves this for system apps.
            }
        }
        if (!asked && (type == BluetoothDevice.DEVICE_TYPE_LE || type == BluetoothDevice.DEVICE_TYPE_DUAL)) {
            // Bonded BLE gadgets (and dual-mode devices) come up through a GATT link.
            openGatt(device, null);
            asked = true;
        }
        final boolean requested = asked;
        call.setKeepAlive(true);
        final long started = System.currentTimeMillis();
        final long window = requested ? 10000 : 7000;
        final Runnable[] poll = new Runnable[1];
        poll[0] = () -> {
            boolean ok = isConnectedNow(adapter, device);
            if (ok || System.currentTimeMillis() - started > window) {
                JSObject out = new JSObject();
                if (ok) {
                    out.put("result", "connected");
                    out.put("message", "Connected.");
                } else if (requested) {
                    out.put("result", "requested");
                    out.put("message", "Paired. If it doesn't connect in a few seconds, tap it in Bluetooth settings.");
                } else {
                    out.put("result", "settings");
                    out.put("message", "Android reconnects earbuds and speakers from its Bluetooth settings. Tap the device there.");
                }
                resolveKeptAlive(call, out);
                return;
            }
            mainHandler.postDelayed(poll[0], 600);
        };
        mainHandler.postDelayed(poll[0], 600);
    }

    /** BLE gadget: open (and keep) a GATT link, resolving when it is up or after 12 s. */
    @SuppressLint("MissingPermission")
    private void connectGattLink(PluginCall call, BluetoothDevice device) {
        call.setKeepAlive(true);
        final boolean[] done = { false };
        final Runnable timeout = () -> {
            if (done[0]) return;
            done[0] = true;
            closeGatt(device.getAddress());
            JSObject out = new JSObject();
            out.put("result", "settings");
            out.put("message", "The device didn't respond. Make sure it's on and not connected to another phone.");
            resolveKeptAlive(call, out);
        };
        mainHandler.postDelayed(timeout, 12000);
        boolean opened = openGatt(device, connected -> {
            if (done[0]) return;
            done[0] = true;
            mainHandler.removeCallbacks(timeout);
            JSObject out = new JSObject();
            out.put("result", connected ? "connected" : "settings");
            out.put("message", connected
                ? "Connected."
                : "The device ended the connection. Try again.");
            resolveKeptAlive(call, out);
        });
        if (!opened) {
            done[0] = true;
            mainHandler.removeCallbacks(timeout);
            JSObject out = new JSObject();
            out.put("result", "settings");
            out.put("message", "Couldn't connect to this device.");
            resolveKeptAlive(call, out);
        }
    }

    private interface LinkListener { void onLink(boolean connected); }

    @SuppressLint("MissingPermission")
    private boolean openGatt(BluetoothDevice device, LinkListener listener) {
        final String key = device.getAddress().toUpperCase(Locale.ROOT);
        closeGatt(key);
        try {
            android.bluetooth.BluetoothGatt gatt = device.connectGatt(getContext(), false, new android.bluetooth.BluetoothGattCallback() {
                @Override
                public void onConnectionStateChange(android.bluetooth.BluetoothGatt g, int status, int newState) {
                    boolean up = newState == BluetoothProfile.STATE_CONNECTED;
                    if (!up && newState == BluetoothProfile.STATE_DISCONNECTED) {
                        gattLinks.remove(key);
                        try { g.close(); } catch (Exception ignored) { /* ignore */ }
                    }
                    if (up || newState == BluetoothProfile.STATE_DISCONNECTED) {
                        JSObject event = new JSObject();
                        event.put("address", key);
                        event.put("connected", up);
                        event.put("at", System.currentTimeMillis());
                        notifyListeners("presence", event);
                        if (listener != null) mainHandler.post(() -> listener.onLink(up));
                    }
                }
            }, BluetoothDevice.TRANSPORT_LE);
            if (gatt == null) return false;
            gattLinks.put(key, gatt);
            return true;
        } catch (SecurityException error) {
            return false;
        }
    }

    @SuppressLint("MissingPermission")
    private void closeGatt(String address) {
        if (address == null) return;
        android.bluetooth.BluetoothGatt g = gattLinks.remove(address.toUpperCase(Locale.ROOT));
        if (g != null) {
            try { g.disconnect(); g.close(); } catch (Exception ignored) { /* ignore */ }
        }
    }

    private boolean isConnectedNow(BluetoothAdapter adapter, BluetoothDevice device) {
        Map<String, List<String>> connected = connectedProfiles(adapter);
        String key;
        try { key = device.getAddress().toUpperCase(Locale.ROOT); } catch (SecurityException e) { return false; }
        List<String> p = connected.get(key);
        return (p != null && !p.isEmpty()) || reflectIsConnected(device);
    }

    /** Disconnects a BLE link this app opened. Audio devices are disconnected from Bluetooth settings. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        String address = call.getString("address");
        closeGatt(address);
        call.resolve();
    }

    // ------------------------------------------------- Guardian deep inspection

    private static final java.util.UUID DIS = java.util.UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb");
    private static final String[][] DIS_FIELDS = {
        { "00002a29-0000-1000-8000-00805f9b34fb", "manufacturer" },
        { "00002a24-0000-1000-8000-00805f9b34fb", "model" },
        { "00002a26-0000-1000-8000-00805f9b34fb", "firmware" },
    };

    /**
     * Pre-pairing GATT inspection: connect without bonding, list services, read the
     * Device Information strings, and test whether the device protects its data
     * (a read that fails with "insufficient authentication/encryption" means it
     * requires pairing before sharing data). Always disconnects; never pairs.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void inspectGatt(PluginCall call) {
        if (!ensureBluetooth(call, true)) return;
        BluetoothAdapter adapter = usableAdapter(call);
        if (adapter == null) return;
        String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address.toUpperCase(Locale.ROOT))) {
            call.reject("This device has no usable Bluetooth address.");
            return;
        }
        final BluetoothDevice device = adapter.getRemoteDevice(address.toUpperCase(Locale.ROOT));
        final JSObject result = new JSObject();
        final JSArray services = new JSArray();
        final JSObject info = new JSObject();
        final java.util.ArrayDeque<android.bluetooth.BluetoothGattCharacteristic> queue = new java.util.ArrayDeque<>();
        final int[] protectedReads = { 0 };
        final int[] openReads = { 0 };
        final boolean[] finished = { false };
        final android.bluetooth.BluetoothGatt[] gattRef = new android.bluetooth.BluetoothGatt[1];

        final Runnable finish = () -> {
            if (finished[0]) return;
            finished[0] = true;
            try { if (gattRef[0] != null) { gattRef[0].disconnect(); gattRef[0].close(); } } catch (Exception ignored) { /* ignore */ }
            result.put("services", services);
            result.put("info", info);
            result.put("protectedReads", protectedReads[0]);
            result.put("openReads", openReads[0]);
            call.resolve(result);
        };
        mainHandler.postDelayed(() -> {
            if (!finished[0]) {
                result.put("timedOut", true);
                finish.run();
            }
        }, 12000);

        android.bluetooth.BluetoothGattCallback callback = new android.bluetooth.BluetoothGattCallback() {
            private void readNext(android.bluetooth.BluetoothGatt gatt) {
                while (!queue.isEmpty()) {
                    android.bluetooth.BluetoothGattCharacteristic c = queue.poll();
                    try {
                        if (gatt.readCharacteristic(c)) return;
                    } catch (SecurityException ignored) { /* skip */ }
                }
                mainHandler.post(finish);
            }

            @Override
            public void onConnectionStateChange(android.bluetooth.BluetoothGatt gatt, int status, int newState) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    result.put("connected", true);
                    try { gatt.discoverServices(); } catch (SecurityException e) { mainHandler.post(finish); }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    if (!result.has("connected")) result.put("connected", false);
                    mainHandler.post(finish);
                }
            }

            @Override
            public void onServicesDiscovered(android.bluetooth.BluetoothGatt gatt, int status) {
                List<android.bluetooth.BluetoothGattService> list = gatt.getServices();
                int probes = 0;
                for (android.bluetooth.BluetoothGattService svc : list) {
                    String uuid = svc.getUuid().toString().toLowerCase(Locale.ROOT);
                    services.put(uuid);
                    for (android.bluetooth.BluetoothGattCharacteristic c : svc.getCharacteristics()) {
                        boolean readable = (c.getProperties() & android.bluetooth.BluetoothGattCharacteristic.PROPERTY_READ) != 0;
                        if (!readable) continue;
                        if (svc.getUuid().equals(DIS)) queue.addFirst(c);
                        else if (probes < 4 && !uuid.startsWith("00001800") && !uuid.startsWith("00001801")) { queue.addLast(c); probes++; }
                    }
                }
                readNext(gatt);
            }

            @Override
            public void onCharacteristicRead(android.bluetooth.BluetoothGatt gatt, android.bluetooth.BluetoothGattCharacteristic c, int status) {
                handleRead(gatt, c, c.getValue(), status);
            }

            @Override
            public void onCharacteristicRead(android.bluetooth.BluetoothGatt gatt, android.bluetooth.BluetoothGattCharacteristic c, byte[] value, int status) {
                handleRead(gatt, c, value, status);
            }

            private void handleRead(android.bluetooth.BluetoothGatt gatt, android.bluetooth.BluetoothGattCharacteristic c, byte[] value, int status) {
                String id = c.getUuid().toString().toLowerCase(Locale.ROOT);
                if (status == android.bluetooth.BluetoothGatt.GATT_SUCCESS) {
                    boolean dis = false;
                    for (String[] f : DIS_FIELDS) {
                        if (f[0].equals(id) && value != null) {
                            info.put(f[1], new String(value, java.nio.charset.StandardCharsets.UTF_8).replaceAll("[\\p{Cntrl}]", "").trim());
                            dis = true;
                        }
                    }
                    if (!dis) openReads[0]++;
                } else if (status == 5 || status == 15 || status == 8) {
                    // 5 = insufficient authentication, 15 = insufficient encryption, 8 = insufficient authorization
                    protectedReads[0]++;
                }
                readNext(gatt);
            }
        };
        try {
            gattRef[0] = device.connectGatt(getContext(), false, callback, BluetoothDevice.TRANSPORT_LE);
            if (gattRef[0] == null) finish.run();
        } catch (SecurityException error) {
            finished[0] = true;
            call.reject("Allow Nearby devices for BlueGuardian, then try again.");
        }
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open Bluetooth settings.");
        }
    }

    // --------------------------------------------------------- find it (RSSI)

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startProximity(PluginCall call) {
        if (!ensureBluetooth(call, true)) return;
        BluetoothAdapter adapter = usableAdapter(call);
        if (adapter == null) return;
        String address = call.getString("address");
        if (address == null) {
            call.reject("Pick a device first.");
            return;
        }
        stopProximityInternal();
        proximityAddress = address.toUpperCase(Locale.ROOT);
        final String target = proximityAddress;
        final String name = call.getString("name");
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner != null) {
            proximityCallback = new ScanCallback() {
                @Override
                public void onScanResult(int callbackType, ScanResult result) {
                    String a = result.getDevice().getAddress();
                    String n = null;
                    try { n = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null; } catch (Exception ignored) { /* ignore */ }
                    boolean match = target.equalsIgnoreCase(a) || (name != null && n != null && name.equalsIgnoreCase(n.trim()));
                    if (match) emitProximity(result.getRssi(), "BLE", a, n);
                }
            };
            try {
                scanner.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), proximityCallback);
            } catch (Exception ignored) {
                proximityCallback = null;
            }
        }
        proximityClassicReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) {
                    BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (d == null) return;
                    String a;
                    try { a = d.getAddress(); } catch (SecurityException e) { return; }
                    if (target.equalsIgnoreCase(a)) {
                        short rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                        if (rssi != Short.MIN_VALUE) emitProximity(rssi, "CLASSIC", a, null);
                    }
                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(intent.getAction()) && classicRestart != null) {
                    mainHandler.postDelayed(classicRestart, 300);
                }
            }
        };
        IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        try {
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(proximityClassicReceiver, filter, Context.RECEIVER_EXPORTED);
            else getContext().registerReceiver(proximityClassicReceiver, filter);
        } catch (Exception ignored) {
            proximityClassicReceiver = null;
        }
        classicRestart = () -> {
            try { if (!adapter.isDiscovering()) adapter.startDiscovery(); } catch (Exception ignored) { /* ignore */ }
        };
        classicRestart.run();

        Integer duration = call.getInt("durationMs", 90000);
        proximityStop = this::stopProximityInternal;
        mainHandler.postDelayed(proximityStop, Math.max(10000, Math.min(180000, duration == null ? 90000 : duration)));

        JSObject out = new JSObject();
        out.put("started", true);
        out.put("connected", isConnectedNow(adapter, adapter.getRemoteDevice(target)));
        String warning = scanVisibilityWarning();
        if (warning != null) out.put("warning", warning);
        call.resolve(out);
    }

    private String scanVisibilityWarning() {
        if (!granted("location")) {
            return "Allow location for BlueGuardian so Android can show this device's signal.";
        }
        try {
            android.location.LocationManager lm = (android.location.LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && !lm.isLocationEnabled()) {
                return "Turn on Location in quick settings so Android can show Bluetooth signals.";
            }
        } catch (RuntimeException ignored) {
            // best effort
        }
        return null;
    }

    private void emitProximity(int rssi, String via, String address, String name) {
        JSObject event = new JSObject();
        event.put("rssi", rssi);
        event.put("via", via);
        event.put("address", address);
        event.put("at", System.currentTimeMillis());
        notifyListeners("proximity", event);
        BlueGuardianPresenceReceiver.LastSeenStore.recordSighting(getContext(), proximityAddress != null ? proximityAddress : address, name, "nearby", rssi);
    }

    @PluginMethod
    public void stopProximity(PluginCall call) {
        stopProximityInternal();
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void stopProximityInternal() {
        if (proximityStop != null) mainHandler.removeCallbacks(proximityStop);
        proximityStop = null;
        classicRestart = null;
        BluetoothAdapter adapter = adapter();
        if (adapter != null) {
            try {
                BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
                if (scanner != null && proximityCallback != null) scanner.stopScan(proximityCallback);
            } catch (Exception ignored) { /* ignore */ }
            try { if (proximityClassicReceiver != null && adapter.isDiscovering()) adapter.cancelDiscovery(); } catch (Exception ignored) { /* ignore */ }
        }
        if (proximityClassicReceiver != null) {
            try { getContext().unregisterReceiver(proximityClassicReceiver); } catch (Exception ignored) { /* ignore */ }
        }
        boolean wasRunning = proximityCallback != null || proximityClassicReceiver != null;
        proximityCallback = null;
        proximityClassicReceiver = null;
        if (wasRunning) {
            JSObject event = new JSObject();
            event.put("stopped", true);
            notifyListeners("proximityState", event);
        }
        proximityAddress = null;
    }

    // ---------------------------------------------------- location & sharing

    @PluginMethod
    public void locationStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("location", granted("location"));
        out.put("background", Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ? granted("location") : granted("backgroundLocation"));
        call.resolve(out);
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (granted("location")) {
            locationStatus(call);
            return;
        }
        requestPermissionForAlias("location", call, "onLocationPermission");
    }

    @PermissionCallback
    private void onLocationPermission(PluginCall call) {
        locationStatus(call);
    }

    /** Android 11+ sends the user to settings to pick "Allow all the time". */
    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (!granted("location")) {
            call.reject("Allow location first.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted("backgroundLocation")) {
            locationStatus(call);
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "onLocationPermission");
    }

    @PluginMethod
    public void getLocation(PluginCall call) {
        if (!granted("location")) {
            call.reject("Location permission is off.");
            return;
        }
        BlueGuardianPresenceReceiver.LastSeenStore.captureLocation(getContext(), 10000, location -> {
            if (location == null) {
                call.reject("Couldn't get your location. Turn on Location and try again.");
                return;
            }
            call.resolve(locationJson(location));
        });
    }

    /** Save the phone's current location as the device's last-seen place (used while it is connected or found). */
    @PluginMethod
    public void saveCurrentLocationFor(PluginCall call) {
        final String address = call.getString("address");
        final String name = call.getString("name");
        final String source = call.getString("source", "app");
        if (address == null) {
            call.reject("Missing device.");
            return;
        }
        if (!granted("location")) {
            call.reject("Location permission is off.");
            return;
        }
        BlueGuardianPresenceReceiver.LastSeenStore.captureLocation(getContext(), 10000, location -> {
            if (location == null) {
                call.reject("Couldn't get a location fix.");
                return;
            }
            BlueGuardianPresenceReceiver.LastSeenStore.recordLocation(getContext(), address, name, location, source);
            call.resolve(locationJson(location));
        });
    }

    private static JSObject locationJson(Location location) {
        JSObject out = new JSObject();
        out.put("lat", location.getLatitude());
        out.put("lng", location.getLongitude());
        out.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1);
        out.put("fixAt", location.getTime());
        return out;
    }

    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        String title = call.getString("title", "Share");
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the share sheet.");
        }
    }

    @PluginMethod
    public void openMap(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        String label = call.getString("label", "Last seen");
        if (lat == null || lng == null) {
            call.reject("No location to show.");
            return;
        }
        String coords = String.format(Locale.ROOT, "%.6f,%.6f", lat, lng);
        try {
            Intent geo = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:" + coords + "?q=" + coords + "(" + Uri.encode(label) + ")"));
            geo.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(geo);
            call.resolve();
        } catch (Exception noMapsApp) {
            try {
                Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=" + coords));
                web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(web);
                call.resolve();
            } catch (Exception error) {
                call.reject("No maps app is installed.");
            }
        }
    }
}
