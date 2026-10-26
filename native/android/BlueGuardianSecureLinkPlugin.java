package com.blueguardian.hybrid;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.provider.MediaStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

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

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secure Link transport for BlueGuardian.
 *
 * Moves opaque, already-encrypted frames between two phones over a Bluetooth LE
 * L2CAP connection-oriented channel (Android 10+). Encryption, authentication,
 * trust scoring and file policy live in the web layer (src/secure); this class
 * only provides: BLE advertising/discovery, the L2CAP socket with length-prefixed
 * framing, an Android Keystore key for wrapping secrets, and an app-private
 * quarantine folder for received files.
 */
@CapacitorPlugin(
    name = "BlueGuardianSecureLink",
    permissions = {
        @Permission(alias = "bluetoothScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "bluetoothAdvertise", strings = { Manifest.permission.BLUETOOTH_ADVERTISE }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class BlueGuardianSecureLinkPlugin extends Plugin {
    private static final UUID SERVICE_UUID = UUID.fromString("6b2f0c1e-5d3a-4c39-9a51-2b7e8f0d4c11");
    private static final ParcelUuid SERVICE_PARCEL = new ParcelUuid(SERVICE_UUID);
    private static final int MAX_FRAME_BYTES = 70000;
    private static final String KEY_ALIAS = "blueguardian.securelink.wrap.v1";
    private static final long RSSI_EMIT_INTERVAL_MS = 900L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private final ExecutorService fileIo = Executors.newSingleThreadExecutor();
    private final Map<String, BluetoothDevice> discoveredDevices = new HashMap<>();
    private final Object linkLock = new Object();

    private BluetoothServerSocket serverSocket;
    private Thread acceptThread;
    private BluetoothLeAdvertiser advertiser;
    private AdvertiseCallback advertiseCallback;
    private String hostCode;
    private int hostPsm = -1;

    private BluetoothLeScanner scanner;
    private ScanCallback discoveryCallback;
    private Runnable discoveryTimeout;
    private ScanCallback rssiCallback;
    private String rssiTargetAddress;
    private long lastRssiEmit;

    private BluetoothSocket linkSocket;
    private DataOutputStream linkOut;
    private Thread readerThread;
    private String linkRole;
    private int linkGeneration;

    // ------------------------------------------------------------ permissions

    private String[] requiredAliases(boolean advertise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return advertise
                ? new String[] { "bluetoothScan", "bluetoothConnect", "bluetoothAdvertise" }
                : new String[] { "bluetoothScan", "bluetoothConnect" };
        }
        return new String[] { "location" };
    }

    private boolean hasAll(String[] aliases) {
        for (String alias : aliases) {
            if (getPermissionState(alias) != PermissionState.GRANTED) return false;
        }
        return true;
    }

    private boolean locationAsked;

    /** Returns true when permissions are present; otherwise requests them and returns false. */
    private boolean ensurePermissions(PluginCall call, boolean advertise) {
        String[] aliases = requiredAliases(advertise);
        // Android 12+ only delivers BLE scan results to this app when location is also granted
        // (BLUETOOTH_SCAN is not declared neverForLocation). Without it the other phone's
        // advertisement is never seen, so ask for it once together with Nearby Devices.
        boolean wantLocation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && !locationAsked && getPermissionState("location") != PermissionState.GRANTED;
        if (hasAll(aliases) && !wantLocation) return true;
        if (wantLocation) {
            locationAsked = true;
            String[] withLocation = java.util.Arrays.copyOf(aliases, aliases.length + 1);
            withLocation[aliases.length] = "location";
            aliases = withLocation;
        }
        requestPermissionForAliases(aliases, call, "onSecureLinkPermissions");
        return false;
    }

    /** Explains why the other phone may not appear (location permission or switch off). */
    private String visibilityWarning() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("location") != PermissionState.GRANTED) {
            return "Location permission is off, so Android may hide the other phone. Allow location for BlueGuardian (no GPS position is used).";
        }
        try {
            android.location.LocationManager lm = (android.location.LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && !lm.isLocationEnabled()) {
                return "Turn on Location in quick settings on this phone; Android hides nearby phones from Bluetooth search while it is off.";
            }
        } catch (RuntimeException ignored) {
            // best effort
        }
        return null;
    }

    @PermissionCallback
    private void onSecureLinkPermissions(PluginCall call) {
        boolean advertise = "startHosting".equals(call.getMethodName());
        if (!hasAll(requiredAliases(advertise))) {
            call.reject("BlueGuardian needs the Nearby Devices permission to create a secure link.");
            return;
        }
        switch (call.getMethodName()) {
            case "startHosting": startHosting(call); break;
            case "discoverHosts": discoverHosts(call); break;
            case "connect": connect(call); break;
            default: call.resolve();
        }
    }

    private BluetoothAdapter adapterOrReject(PluginCall call) {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
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
            call.reject("BlueGuardian cannot read the Bluetooth state. Allow Nearby Devices and retry.");
            return null;
        }
        return adapter;
    }

    // ------------------------------------------------------------ capabilities

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject out = new JSObject();
        out.put("sdk", Build.VERSION.SDK_INT);
        out.put("l2cap", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        boolean advertising = false;
        boolean enabled = false;
        try {
            if (adapter != null) {
                enabled = adapter.isEnabled();
                advertising = adapter.isMultipleAdvertisementSupported();
            }
        } catch (SecurityException ignored) {
            // permission not granted yet
        }
        out.put("bluetoothEnabled", enabled);
        out.put("advertising", advertising);
        out.put("strongBox", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            && getContext().getPackageManager().hasSystemFeature("android.hardware.strongbox_keystore"));
        // Channel Sounding distance is not exposed to apps through a stable public API on most phones yet.
        out.put("channelSounding", false);
        call.resolve(out);
    }

    // ------------------------------------------------------------------ hosting

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startHosting(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Secure Link needs Android 10 or newer (Bluetooth LE L2CAP channels).");
            return;
        }
        if (!ensurePermissions(call, true)) return;
        BluetoothAdapter adapter = adapterOrReject(call);
        if (adapter == null) return;
        String code = call.getString("code", "0000");
        if (code == null || !code.matches("\\d{4}")) code = "0000";

        stopHostingInternal();
        try {
            serverSocket = adapter.listenUsingInsecureL2capChannel();
            hostPsm = serverSocket.getPsm();
        } catch (IOException | SecurityException error) {
            call.reject("Could not open a Bluetooth channel: " + safe(error));
            return;
        }

        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            closeQuietly(serverSocket);
            serverSocket = null;
            call.reject("This phone cannot advertise over Bluetooth LE, so it cannot host. Use \"Connect\" on this phone instead.");
            return;
        }
        hostCode = code;
        byte[] serviceData = new byte[] {
            (byte) ((hostPsm >> 8) & 0xff), (byte) (hostPsm & 0xff),
            (byte) code.charAt(0), (byte) code.charAt(1), (byte) code.charAt(2), (byte) code.charAt(3)
        };
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .setTimeout(0)
            .build();
        AdvertiseData data = new AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceData(SERVICE_PARCEL, serviceData)
            .build();
        final PluginCall startCall = call;
        advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                JSObject out = new JSObject();
                out.put("psm", hostPsm);
                out.put("code", hostCode);
                startCall.resolve(out);
            }

            @Override
            public void onStartFailure(int errorCode) {
                stopHostingInternal();
                startCall.reject("Bluetooth advertising failed (code " + errorCode + "). Turn Bluetooth off and on, then retry.");
            }
        };
        try {
            advertiser.startAdvertising(settings, data, advertiseCallback);
        } catch (SecurityException error) {
            stopHostingInternal();
            call.reject("Advertising permission was denied.");
            return;
        }

        final BluetoothServerSocket listening = serverSocket;
        acceptThread = new Thread(() -> acceptLoop(listening), "bg-securelink-accept");
        acceptThread.start();
    }

    private void acceptLoop(BluetoothServerSocket listening) {
        while (listening != null) {
            BluetoothSocket socket;
            try {
                socket = listening.accept();
            } catch (IOException error) {
                return; // server socket closed
            }
            if (socket == null) continue;
            boolean busy;
            synchronized (linkLock) {
                busy = linkSocket != null;
            }
            if (busy) {
                // Someone else tried to connect while a session is live: count it, refuse it.
                JSObject attempt = new JSObject();
                attempt.put("address", addressOf(socket));
                attempt.put("observedAt", System.currentTimeMillis());
                notifyListeners("linkAttempt", attempt);
                closeQuietly(socket);
                continue;
            }
            startLink(socket, "host");
        }
    }

    @PluginMethod
    public void stopHosting(PluginCall call) {
        stopHostingInternal();
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void stopHostingInternal() {
        if (advertiser != null && advertiseCallback != null) {
            try {
                advertiser.stopAdvertising(advertiseCallback);
            } catch (SecurityException | IllegalStateException ignored) {
                // adapter turned off or permission revoked
            }
        }
        advertiseCallback = null;
        advertiser = null;
        if (serverSocket != null) closeQuietly(serverSocket);
        serverSocket = null;
        acceptThread = null;
        hostPsm = -1;
    }

    // ---------------------------------------------------------------- discovery

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void discoverHosts(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Secure Link needs Android 10 or newer (Bluetooth LE L2CAP channels).");
            return;
        }
        if (!ensurePermissions(call, false)) return;
        BluetoothAdapter adapter = adapterOrReject(call);
        if (adapter == null) return;
        stopDiscoveryInternal(false);
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("Bluetooth LE scanning is not available right now.");
            return;
        }
        Integer requested = call.getInt("durationMs", 15000);
        int durationMs = Math.max(4000, Math.min(60000, requested == null ? 15000 : requested));
        discoveryCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                emitHost(result);
            }

            @Override
            public void onBatchScanResults(List<ScanResult> results) {
                for (ScanResult r : results) emitHost(r);
            }

            @Override
            public void onScanFailed(int errorCode) {
                JSObject state = new JSObject();
                state.put("state", "error");
                state.put("message", "Bluetooth scan failed (code " + errorCode + ").");
                notifyListeners("discoveryState", state);
            }
        };
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try {
            // Unfiltered on purpose: some phones drop service-data filters in hardware offload.
            scanner.startScan(null, settings, discoveryCallback);
        } catch (SecurityException error) {
            call.reject("Scanning permission was denied.");
            return;
        }
        discoveryTimeout = () -> stopDiscoveryInternal(true);
        mainHandler.postDelayed(discoveryTimeout, durationMs);
        JSObject out = new JSObject();
        out.put("durationMs", durationMs);
        String warning = visibilityWarning();
        if (warning != null) out.put("warning", warning);
        call.resolve(out);
    }

    @SuppressLint("MissingPermission")
    private void emitHost(ScanResult result) {
        ScanRecord record = result.getScanRecord();
        if (record == null) return;
        byte[] data = record.getServiceData(SERVICE_PARCEL);
        if (data == null || data.length < 6) return;
        BluetoothDevice device = result.getDevice();
        String address = device.getAddress();
        discoveredDevices.put(address, device);
        JSObject host = new JSObject();
        host.put("address", address);
        host.put("rssi", result.getRssi());
        host.put("psm", ((data[0] & 0xff) << 8) | (data[1] & 0xff));
        host.put("code", new String(data, 2, 4, StandardCharsets.US_ASCII));
        host.put("observedAt", System.currentTimeMillis());
        notifyListeners("hostFound", host);
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        stopDiscoveryInternal(true);
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void stopDiscoveryInternal(boolean emit) {
        if (discoveryTimeout != null) mainHandler.removeCallbacks(discoveryTimeout);
        discoveryTimeout = null;
        if (scanner != null && discoveryCallback != null) {
            try {
                scanner.stopScan(discoveryCallback);
            } catch (SecurityException | IllegalStateException ignored) {
                // adapter off
            }
        }
        boolean wasScanning = discoveryCallback != null;
        discoveryCallback = null;
        if (emit && wasScanning) {
            JSObject state = new JSObject();
            state.put("state", "complete");
            notifyListeners("discoveryState", state);
        }
    }

    // ------------------------------------------------------------------ connect

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Secure Link needs Android 10 or newer (Bluetooth LE L2CAP channels).");
            return;
        }
        if (!ensurePermissions(call, false)) return;
        BluetoothAdapter adapter = adapterOrReject(call);
        if (adapter == null) return;
        String address = call.getString("address");
        Integer psm = call.getInt("psm");
        if (address == null || psm == null || psm <= 0) {
            call.reject("Pick a device to connect to.");
            return;
        }
        synchronized (linkLock) {
            if (linkSocket != null) {
                call.reject("A secure link is already open. Disconnect first.");
                return;
            }
        }
        stopDiscoveryInternal(false);
        BluetoothDevice known = discoveredDevices.get(address);
        final BluetoothDevice device = known != null ? known : adapter.getRemoteDevice(address);
        final int channel = psm;
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                socket = device.createInsecureL2capChannel(channel);
                socket.connect();
                startLink(socket, "client");
                startRssiMonitor(adapter, address);
                JSObject out = new JSObject();
                out.put("connected", true);
                call.resolve(out);
            } catch (IOException | SecurityException error) {
                if (socket != null) closeQuietly(socket);
                call.reject("Could not reach that phone. Make sure it is still hosting and nearby. (" + safe(error) + ")");
            }
        }, "bg-securelink-connect").start();
    }

    private void startLink(BluetoothSocket socket, String role) {
        final int generation;
        final InputStream in;
        try {
            in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();
            synchronized (linkLock) {
                linkSocket = socket;
                linkOut = new DataOutputStream(out);
                linkRole = role;
                generation = ++linkGeneration;
            }
        } catch (IOException error) {
            closeQuietly(socket);
            return;
        }
        JSObject state = new JSObject();
        state.put("state", "connected");
        state.put("role", role);
        state.put("address", addressOf(socket));
        notifyListeners("linkState", state);
        readerThread = new Thread(() -> readLoop(new DataInputStream(in), generation), "bg-securelink-reader");
        readerThread.start();
    }

    private void readLoop(DataInputStream in, int generation) {
        String reason = "closed";
        try {
            while (true) {
                int length = in.readInt();
                if (length <= 0 || length > MAX_FRAME_BYTES) {
                    reason = "peer sent an invalid frame size";
                    break;
                }
                byte[] frame = new byte[length];
                in.readFully(frame);
                JSObject event = new JSObject();
                event.put("data", Base64.encodeToString(frame, Base64.NO_WRAP));
                notifyListeners("linkFrame", event);
            }
        } catch (IOException error) {
            reason = "connection lost";
        }
        closeLink(generation, reason);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Nothing to send.");
            return;
        }
        final byte[] frame;
        try {
            frame = Base64.decode(data, Base64.NO_WRAP);
        } catch (IllegalArgumentException error) {
            call.reject("Invalid frame encoding.");
            return;
        }
        if (frame.length == 0 || frame.length > MAX_FRAME_BYTES) {
            call.reject("Frame is too large.");
            return;
        }
        writer.execute(() -> {
            DataOutputStream out;
            int generation;
            synchronized (linkLock) {
                out = linkOut;
                generation = linkGeneration;
            }
            if (out == null) {
                call.reject("The secure link is not connected.");
                return;
            }
            try {
                out.writeInt(frame.length);
                out.write(frame);
                out.flush();
                call.resolve();
            } catch (IOException error) {
                call.reject("Sending failed: connection lost.");
                closeLink(generation, "connection lost");
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        int generation;
        synchronized (linkLock) {
            generation = linkGeneration;
        }
        closeLink(generation, "closed by user");
        call.resolve();
    }

    private void closeLink(int generation, String reason) {
        BluetoothSocket socket;
        String role;
        synchronized (linkLock) {
            if (generation != linkGeneration || linkSocket == null) return;
            socket = linkSocket;
            role = linkRole;
            linkSocket = null;
            linkOut = null;
            linkRole = null;
        }
        closeQuietly(socket);
        stopRssiMonitor();
        JSObject state = new JSObject();
        state.put("state", "closed");
        state.put("role", role);
        state.put("message", reason);
        notifyListeners("linkState", state);
    }

    @SuppressLint("MissingPermission")
    private void startRssiMonitor(BluetoothAdapter adapter, String address) {
        BluetoothLeScanner monitorScanner = adapter.getBluetoothLeScanner();
        if (monitorScanner == null) return;
        stopRssiMonitor();
        rssiTargetAddress = address;
        scanner = monitorScanner;
        rssiCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (!result.getDevice().getAddress().equals(rssiTargetAddress)) return;
                long now = System.currentTimeMillis();
                if (now - lastRssiEmit < RSSI_EMIT_INTERVAL_MS) return;
                lastRssiEmit = now;
                JSObject event = new JSObject();
                event.put("rssi", result.getRssi());
                event.put("observedAt", now);
                notifyListeners("peerRssi", event);
            }
        };
        try {
            monitorScanner.startScan(null,
                new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build(),
                rssiCallback);
        } catch (SecurityException | IllegalStateException ignored) {
            rssiCallback = null;
        }
    }

    @SuppressLint("MissingPermission")
    private void stopRssiMonitor() {
        if (scanner != null && rssiCallback != null) {
            try {
                scanner.stopScan(rssiCallback);
            } catch (SecurityException | IllegalStateException ignored) {
                // adapter off
            }
        }
        rssiCallback = null;
        rssiTargetAddress = null;
    }

    // ----------------------------------------------------------------- keystore

    private SecretKey wrappingKey(boolean[] strongBoxOut) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                generator.init(keySpec(true));
                SecretKey key = generator.generateKey();
                strongBoxOut[0] = true;
                return key;
            } catch (Exception strongBoxUnavailable) {
                // fall back to the TEE-backed keystore
            }
        }
        generator.init(keySpec(false));
        return generator.generateKey();
    }

    private KeyGenParameterSpec keySpec(boolean strongBox) {
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
            KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) builder.setIsStrongBoxBacked(true);
        return builder.build();
    }

    @PluginMethod
    public void keystoreInfo(PluginCall call) {
        boolean[] strongBox = new boolean[] { false };
        try {
            wrappingKey(strongBox);
            JSObject out = new JSObject();
            out.put("available", true);
            out.put("strongBox", strongBox[0] || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                && getContext().getPackageManager().hasSystemFeature("android.hardware.strongbox_keystore")));
            call.resolve(out);
        } catch (Exception error) {
            JSObject out = new JSObject();
            out.put("available", false);
            out.put("message", safe(error));
            call.resolve(out);
        }
    }

    @PluginMethod
    public void wrapSecret(PluginCall call) {
        try {
            byte[] plaintext = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(new boolean[] { false }));
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(plaintext);
            byte[] blob = new byte[1 + iv.length + sealed.length];
            blob[0] = (byte) iv.length;
            System.arraycopy(iv, 0, blob, 1, iv.length);
            System.arraycopy(sealed, 0, blob, 1 + iv.length, sealed.length);
            JSObject out = new JSObject();
            out.put("blob", "ks1:" + Base64.encodeToString(blob, Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception error) {
            call.reject("Could not protect the key with the Android Keystore: " + safe(error));
        }
    }

    @PluginMethod
    public void unwrapSecret(PluginCall call) {
        try {
            String text = call.getString("blob", "");
            if (text == null || !text.startsWith("ks1:")) throw new IllegalArgumentException("unknown format");
            byte[] blob = Base64.decode(text.substring(4), Base64.NO_WRAP);
            int ivLength = blob[0] & 0xff;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey(new boolean[] { false }),
                new GCMParameterSpec(128, blob, 1, ivLength));
            byte[] plaintext = cipher.doFinal(blob, 1 + ivLength, blob.length - 1 - ivLength);
            JSObject out = new JSObject();
            out.put("data", Base64.encodeToString(plaintext, Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception error) {
            call.reject("Could not unlock the stored key: " + safe(error));
        }
    }

    // --------------------------------------------------------------- quarantine

    private File quarantineDir() {
        File dir = new File(getContext().getFilesDir(), "quarantine");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cannot create quarantine folder");
        return dir;
    }

    private String validKey(PluginCall call) {
        String key = call.getString("key");
        if (key == null || !key.matches("[0-9a-f]{64}")) {
            call.reject("Invalid quarantine key.");
            return null;
        }
        return key;
    }

    @PluginMethod
    public void quarantineOpen(PluginCall call) {
        String key = validKey(call);
        if (key == null) return;
        fileIo.execute(() -> {
            try {
                File part = new File(quarantineDir(), key + ".part");
                if (!part.exists() && !part.createNewFile()) throw new IOException("cannot create file");
                long free = quarantineDir().getUsableSpace();
                Long size = call.getLong("size", 0L);
                if (size != null && size > free - 50L * 1024 * 1024) throw new IOException("not enough free storage");
                JSObject out = new JSObject();
                out.put("existingBytes", part.length());
                call.resolve(out);
            } catch (Exception error) {
                call.reject("Could not prepare the quarantine folder: " + safe(error));
            }
        });
    }

    @PluginMethod
    public void quarantineWrite(PluginCall call) {
        String key = validKey(call);
        if (key == null) return;
        Long offset = call.getLong("offset", -1L);
        String data = call.getString("data", "");
        fileIo.execute(() -> {
            try (RandomAccessFile file = new RandomAccessFile(new File(quarantineDir(), key + ".part"), "rw")) {
                if (offset == null || offset != file.length()) throw new IOException("non-sequential write");
                file.seek(offset);
                file.write(Base64.decode(data, Base64.NO_WRAP));
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not write the received file: " + safe(error));
            }
        });
    }

    @PluginMethod
    public void quarantineFinalize(PluginCall call) {
        String key = validKey(call);
        if (key == null) return;
        fileIo.execute(() -> {
            File part = new File(quarantineDir(), key + ".part");
            try (FileInputStream in = new FileInputStream(part)) {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] buffer = new byte[64 * 1024];
                byte[] head = new byte[64];
                int headLength = 0;
                int read;
                while ((read = in.read(buffer)) > 0) {
                    if (headLength < head.length) {
                        int take = Math.min(head.length - headLength, read);
                        System.arraycopy(buffer, 0, head, headLength, take);
                        headLength += take;
                    }
                    digest.update(buffer, 0, read);
                }
                JSObject out = new JSObject();
                out.put("sha256", toHex(digest.digest()));
                out.put("size", part.length());
                out.put("head", Base64.encodeToString(head, 0, headLength, Base64.NO_WRAP));
                call.resolve(out);
            } catch (Exception error) {
                call.reject("Could not verify the received file: " + safe(error));
            }
        });
    }

    @PluginMethod
    public void quarantineDiscard(PluginCall call) {
        String key = validKey(call);
        if (key == null) return;
        fileIo.execute(() -> {
            File dir = quarantineDir();
            deleteQuietly(new File(dir, key + ".part"));
            deleteQuietly(new File(dir, key + ".bin"));
            deleteQuietly(new File(dir, key + ".json"));
            call.resolve();
        });
    }

    @PluginMethod
    public void quarantineAccept(PluginCall call) {
        String key = validKey(call);
        if (key == null) return;
        fileIo.execute(() -> {
            try {
                File dir = quarantineDir();
                File part = new File(dir, key + ".part");
                File bin = new File(dir, key + ".bin");
                deleteQuietly(bin);
                if (!part.renameTo(bin)) throw new IOException("rename failed");
                JSONObject meta = new JSONObject();
                meta.put("key", key);
                meta.put("name", call.getString("name", "received-file"));
                meta.put("mime", call.getString("mime", "application/octet-stream"));
                meta.put("kind", call.getString("kind", "unknown"));
                meta.put("size", bin.length());
                meta.put("from", call.getString("from", ""));
                meta.put("receivedAt", System.currentTimeMillis());
                try (FileOutputStream out = new FileOutputStream(new File(dir, key + ".json"))) {
                    out.write(meta.toString().getBytes(StandardCharsets.UTF_8));
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not store the verified file: " + safe(error));
            }
        });
    }

    @PluginMethod
    public void quarantineList(PluginCall call) {
        fileIo.execute(() -> {
            JSArray files = new JSArray();
            File[] metas = quarantineDir().listFiles((d, name) -> name.endsWith(".json"));
            List<File> list = new ArrayList<>();
            if (metas != null) for (File f : metas) list.add(f);
            for (File meta : list) {
                try (FileInputStream in = new FileInputStream(meta)) {
                    byte[] bytes = new byte[(int) Math.min(meta.length(), 8192)];
                    int n = in.read(bytes);
                    files.put(new JSONObject(new String(bytes, 0, Math.max(0, n), StandardCharsets.UTF_8)));
                } catch (Exception ignored) {
                    // skip unreadable metadata
                }
            }
            JSObject out = new JSObject();
            out.put("files", files);
            call.resolve(out);
        });
    }

    /**
     * Copy a verified file to Downloads/BlueGuardian. The user does this explicitly;
     * files are never opened automatically.
     */
    @PluginMethod
    public void quarantineExport(PluginCall call) {
        String key = validKey(call);
        if (key == null) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Saving to Downloads needs Android 10 or newer.");
            return;
        }
        fileIo.execute(() -> {
            File dir = quarantineDir();
            File bin = new File(dir, key + ".bin");
            try {
                JSONObject meta;
                try (FileInputStream in = new FileInputStream(new File(dir, key + ".json"))) {
                    byte[] bytes = new byte[8192];
                    int n = in.read(bytes);
                    meta = new JSONObject(new String(bytes, 0, Math.max(0, n), StandardCharsets.UTF_8));
                }
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, meta.optString("name", "received-file"));
                values.put(MediaStore.MediaColumns.MIME_TYPE, meta.optString("mime", "application/octet-stream"));
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/BlueGuardian");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("Downloads is not available");
                try (OutputStream out = resolver.openOutputStream(uri); FileInputStream in = new FileInputStream(bin)) {
                    if (out == null) throw new IOException("cannot open destination");
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, done, null, null);
                JSObject out = new JSObject();
                out.put("location", "Download/BlueGuardian/" + meta.optString("name", "received-file"));
                call.resolve(out);
            } catch (Exception error) {
                call.reject("Could not save to Downloads: " + safe(error));
            }
        });
    }

    // ------------------------------------------------------------------ helpers

    @Override
    protected void handleOnDestroy() {
        stopDiscoveryInternal(false);
        stopHostingInternal();
        int generation;
        synchronized (linkLock) {
            generation = linkGeneration;
        }
        closeLink(generation, "app closed");
        writer.shutdownNow();
        fileIo.shutdownNow();
        super.handleOnDestroy();
    }

    @SuppressLint("MissingPermission")
    private static String addressOf(BluetoothSocket socket) {
        try {
            BluetoothDevice device = socket.getRemoteDevice();
            return device != null ? device.getAddress() : "";
        } catch (SecurityException error) {
            return "";
        }
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (IOException ignored) {
            // nothing to do
        }
    }

    private static void deleteQuietly(File file) {
        if (file.exists() && !file.delete()) file.deleteOnExit();
    }

    private static String toHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }

    private static String safe(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }
}
