package com.blueguardian.hybrid;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
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
import android.content.pm.PackageManager;
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

import java.io.ByteArrayOutputStream;
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
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secure Link transport for BlueGuardian.
 *
 * Moves opaque, already-encrypted frames between two phones over Bluetooth LE.
 * Encryption, authentication, trust scoring and file policy live in the web layer
 * (src/secure); this class only provides: BLE advertising/discovery, a transport with
 * length-prefixed framing, an Android Keystore key for wrapping secrets, and an
 * app-private quarantine folder for received files.
 *
 * Transports (chosen automatically, same frames either way):
 *  - L2CAP connection-oriented channel: fastest; both phones Android 10+.
 *  - GATT (write-without-response + notifications, MTU up to 517): works on
 *    Android 8 and 9, and is the automatic fallback when a phone's L2CAP stack
 *    refuses the channel.
 * While a link is live the host stops advertising and nobody scans (both compete
 * with the connection for radio time), and the link runs at high connection
 * priority with signal strength read from the connection itself.
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
    /** GATT transport: phone that connects writes here. */
    private static final UUID RX_UUID = UUID.fromString("6b2f0c1e-5d3a-4c39-9a51-2b7e8f0d4c12");
    /** GATT transport: hosting phone notifies here. */
    private static final UUID TX_UUID = UUID.fromString("6b2f0c1e-5d3a-4c39-9a51-2b7e8f0d4c13");
    private static final UUID CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final long SEGMENT_ACK_TIMEOUT_MS = 6000L;
    private static final long GATT_SETUP_TIMEOUT_MS = 15000L;
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
    private long lastRssiEmit;

    private BluetoothSocket linkSocket;
    private DataOutputStream linkOut;
    private Thread readerThread;
    private String linkRole;
    private int linkGeneration;
    /** "l2cap", "gatt-client" or "gatt-server" while a link is up; null otherwise. */
    private String linkTransport;

    // GATT transport state
    private BluetoothGattServer gattServer;
    private BluetoothGattCharacteristic serverTx;
    private BluetoothDevice serverPeer;
    private BluetoothGatt clientGatt;
    private BluetoothGattCharacteristic clientRx;
    private volatile int linkMtu = 23;
    private volatile Semaphore segmentAck;
    private volatile boolean segmentOk;
    private final ByteArrayOutputStream inbound = new ByteArrayOutputStream();
    private Runnable gattSetupTimeout;
    private PluginCall pendingConnect;

    // Link keeper for L2CAP links: high connection priority + RSSI from the connection.
    private BluetoothGatt keeperGatt;
    private Runnable rssiPoll;

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
            return "Allow location for BlueGuardian so Android can show the other phone.";
        }
        try {
            android.location.LocationManager lm = (android.location.LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && !lm.isLocationEnabled()) {
                return "Turn on Location in quick settings so Android can find the other phone.";
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
            call.reject("Allow Nearby devices for BlueGuardian to use Secure Share.");
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
        // GATT transport covers Android 8 and newer, so Secure Share works there too.
        out.put("gatt", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
        out.put("secureShare", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE));
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
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Secure Share needs Android 8 or newer.");
            return;
        }
        if (!ensurePermissions(call, true)) return;
        BluetoothAdapter adapter = adapterOrReject(call);
        if (adapter == null) return;
        String code = call.getString("code", "0000");
        if (code == null || !code.matches("\\d{4}")) code = "0000";

        stopHostingInternal();
        // L2CAP channel where the phone has one (Android 10+); a GATT server always, so
        // Android 8-9 phones and phones with a broken L2CAP stack can still connect.
        hostPsm = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                serverSocket = adapter.listenUsingInsecureL2capChannel();
                hostPsm = serverSocket.getPsm();
            } catch (IOException | SecurityException error) {
                serverSocket = null;
                hostPsm = 0;
            }
        }
        String gattError = openGattServer();
        if (serverSocket == null && gattError != null) {
            call.reject("Could not open a Bluetooth channel: " + gattError);
            return;
        }

        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            stopHostingInternal();
            call.reject("This phone can't receive this way. Tap Send on this phone instead.");
            return;
        }
        hostCode = code;
        int psm = Math.max(0, hostPsm);
        byte[] serviceData = new byte[] {
            (byte) ((psm >> 8) & 0xff), (byte) (psm & 0xff),
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
                out.put("transport", hostPsm > 0 ? "l2cap+gatt" : "gatt");
                startCall.resolve(out);
            }

            @Override
            public void onStartFailure(int errorCode) {
                stopHostingInternal();
                startCall.reject("Couldn't become visible (code " + errorCode + "). Turn Bluetooth off and on, then try again.");
            }
        };
        lastAdvertiseSettings = settings;
        lastAdvertiseData = data;
        try {
            advertiser.startAdvertising(settings, data, advertiseCallback);
        } catch (SecurityException error) {
            stopHostingInternal();
            call.reject("Advertising permission was denied.");
            return;
        }

        if (serverSocket != null) {
            final BluetoothServerSocket listening = serverSocket;
            acceptThread = new Thread(() -> acceptLoop(listening), "bg-securelink-accept");
            acceptThread.start();
        }
    }

    private AdvertiseSettings lastAdvertiseSettings;
    private AdvertiseData lastAdvertiseData;

    /**
     * A link dropped while still hosting: become visible again with the same code so the
     * other phone can reconnect by itself (its transfer resumes from the last chunk).
     */
    @SuppressLint("MissingPermission")
    private void resumeAdvertising() {
        final BluetoothLeAdvertiser adv = advertiser;
        final AdvertiseSettings settings = lastAdvertiseSettings;
        final AdvertiseData data = lastAdvertiseData;
        if (adv == null || settings == null || data == null || advertiseCallback == null) return;
        final AdvertiseCallback resumed = new AdvertiseCallback() {
            @Override
            public void onStartFailure(int errorCode) {
                // Visible again failed; JS stops hosting after its reconnect window anyway.
            }
        };
        mainHandler.post(() -> {
            if (advertiser != adv || advertiseCallback == null) return;
            try {
                adv.stopAdvertising(advertiseCallback);
            } catch (RuntimeException ignored) { /* already stopped */ }
            advertiseCallback = resumed;
            try {
                adv.startAdvertising(settings, data, resumed);
            } catch (RuntimeException ignored) { /* adapter off */ }
        });
    }

    /** Stop advertising but keep the channel/GATT server open: used once a link is live. */
    @SuppressLint("MissingPermission")
    private void pauseAdvertising() {
        BluetoothLeAdvertiser adv = advertiser;
        AdvertiseCallback cb = advertiseCallback;
        if (adv != null && cb != null) {
            try {
                adv.stopAdvertising(cb);
            } catch (RuntimeException ignored) {
                // adapter off or permission revoked
            }
        }
    }

    // --------------------------------------------------------- GATT server (host)

    @SuppressLint("MissingPermission")
    private String openGattServer() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager == null) return "no Bluetooth manager";
        try {
            gattServer = manager.openGattServer(getContext(), gattServerCallback);
        } catch (RuntimeException error) {
            gattServer = null;
            return safe(error);
        }
        if (gattServer == null) return "GATT server unavailable";
        BluetoothGattService service = new BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        BluetoothGattCharacteristic rx = new BluetoothGattCharacteristic(RX_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE);
        BluetoothGattCharacteristic tx = new BluetoothGattCharacteristic(TX_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ);
        tx.addDescriptor(new BluetoothGattDescriptor(CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        service.addCharacteristic(rx);
        service.addCharacteristic(tx);
        serverTx = tx;
        try {
            if (!gattServer.addService(service)) return "could not add the share service";
        } catch (RuntimeException error) {
            return safe(error);
        }
        return null;
    }

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                BluetoothDevice peer = serverPeer;
                if (peer != null && peer.getAddress().equals(device.getAddress()) && "gatt-server".equals(linkTransport)) {
                    closeLink(linkGeneration, "connection lost");
                }
            }
        }

        @Override
        public void onMtuChanged(BluetoothDevice device, int mtu) {
            BluetoothDevice peer = serverPeer;
            if (peer == null || peer.getAddress().equals(device.getAddress())) linkMtu = mtu;
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor descriptor,
                                             boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            boolean enable = value != null && value.length >= 1 && (value[0] & 0x01) != 0;
            boolean ok = CCCD_UUID.equals(descriptor.getUuid()) && TX_UUID.equals(descriptor.getCharacteristic().getUuid());
            boolean busy;
            synchronized (linkLock) {
                busy = linkTransport != null;
            }
            BluetoothGattServer server = gattServer;
            if (responseNeeded && server != null) {
                try {
                    server.sendResponse(device, requestId, ok && !(enable && busy) ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, offset, value);
                } catch (RuntimeException ignored) { /* peer left */ }
            }
            if (!ok || !enable) return;
            if (busy) {
                JSObject attempt = new JSObject();
                attempt.put("address", device.getAddress());
                attempt.put("observedAt", System.currentTimeMillis());
                notifyListeners("linkAttempt", attempt);
                return;
            }
            startGattLink(null, device, "host");
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic characteristic,
                                                 boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            BluetoothGattServer server = gattServer;
            BluetoothDevice peer = serverPeer;
            boolean fromPeer = peer != null && peer.getAddress().equals(device.getAddress()) && RX_UUID.equals(characteristic.getUuid());
            if (responseNeeded && server != null) {
                try {
                    server.sendResponse(device, requestId, fromPeer ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_WRITE_NOT_PERMITTED, offset, null);
                } catch (RuntimeException ignored) { /* peer left */ }
            }
            if (fromPeer && value != null) acceptInbound(value, linkGeneration);
        }

        @Override
        public void onNotificationSent(BluetoothDevice device, int status) {
            segmentOk = status == BluetoothGatt.GATT_SUCCESS;
            Semaphore ack = segmentAck;
            if (ack != null) ack.release();
        }
    };

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
                busy = linkTransport != null;
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
        BluetoothGattServer server = gattServer;
        gattServer = null;
        serverTx = null;
        if (server != null && !"gatt-server".equals(linkTransport)) {
            try { server.close(); } catch (RuntimeException ignored) { /* already closed */ }
        } else if (server != null) {
            // A GATT link is live on this server; it is closed together with the link.
            pendingServerClose = server;
        }
    }

    private BluetoothGattServer pendingServerClose;

    // ---------------------------------------------------------------- discovery

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void discoverHosts(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Secure Share needs Android 8 or newer.");
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
        final ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        final BluetoothLeScanner discoveryScanner = scanner;
        final ScanCallback cb = discoveryCallback;
        // Respect Android's 5-scans-per-30-s limit (shared with the main scanner): a
        // throttled scan is accepted but sees nothing, which looked like "phone not found".
        long delay = BlueGuardianBluetoothPlugin.ScanBudget.delayFor(1);
        Runnable begin = () -> {
            if (discoveryCallback != cb) return;
            try {
                // Unfiltered on purpose: some phones drop service-data filters in hardware offload.
                discoveryScanner.startScan(null, settings, cb);
                BlueGuardianBluetoothPlugin.ScanBudget.record(1);
            } catch (RuntimeException error) {
                JSObject state = new JSObject();
                state.put("state", "error");
                state.put("message", "Bluetooth scan could not start: " + safe(error));
                notifyListeners("discoveryState", state);
            }
        };
        if (delay > 0) mainHandler.postDelayed(begin, delay);
        else begin.run();
        discoveryTimeout = () -> stopDiscoveryInternal(true);
        mainHandler.postDelayed(discoveryTimeout, durationMs + delay);
        JSObject out = new JSObject();
        out.put("durationMs", durationMs);
        if (delay > 0) out.put("startDelayMs", delay);
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
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Secure Share needs Android 8 or newer.");
            return;
        }
        if (!ensurePermissions(call, false)) return;
        BluetoothAdapter adapter = adapterOrReject(call);
        if (adapter == null) return;
        String address = call.getString("address");
        Integer psm = call.getInt("psm");
        if (address == null || psm == null || psm < 0) {
            call.reject("Pick a device to connect to.");
            return;
        }
        synchronized (linkLock) {
            if (linkTransport != null) {
                call.reject("A secure link is already open. Disconnect first.");
                return;
            }
        }
        stopDiscoveryInternal(false);
        BluetoothDevice known = discoveredDevices.get(address);
        final BluetoothDevice device = known != null ? known : adapter.getRemoteDevice(address);
        final int channel = psm;
        // Fastest first: L2CAP channel when both phones support it; otherwise (Android 8-9,
        // or a phone whose L2CAP stack refuses) the GATT transport. Same frames either way.
        if (channel <= 0 || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            connectGatt(call, device);
            return;
        }
        new Thread(() -> {
            BluetoothSocket socket = null;
            String l2capError = null;
            for (int attempt = 0; attempt < 2 && socket == null; attempt++) {
                BluetoothSocket candidate = null;
                try {
                    candidate = device.createInsecureL2capChannel(channel);
                    candidate.connect();
                    socket = candidate;
                } catch (IOException | SecurityException error) {
                    if (candidate != null) closeQuietly(candidate);
                    l2capError = safe(error);
                    try { Thread.sleep(400); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                }
            }
            if (socket != null) {
                startLink(socket, "client");
                JSObject out = new JSObject();
                out.put("connected", true);
                out.put("transport", "l2cap");
                call.resolve(out);
                return;
            }
            final String reason = l2capError;
            mainHandler.post(() -> connectGattWithReason(call, device, reason));
        }, "bg-securelink-connect").start();
    }

    private void connectGattWithReason(PluginCall call, BluetoothDevice device, String l2capError) {
        call.getData().put("l2capError", l2capError == null ? "" : l2capError);
        connectGatt(call, device);
    }

    // --------------------------------------------------------- GATT client (sender)

    @SuppressLint("MissingPermission")
    private void connectGatt(PluginCall call, BluetoothDevice device) {
        synchronized (linkLock) {
            if (linkTransport != null || pendingConnect != null) {
                call.reject("A secure link is already open. Disconnect first.");
                return;
            }
            pendingConnect = call;
        }
        linkMtu = 23;
        gattSetupTimeout = () -> failGattSetup("the other phone didn't answer");
        mainHandler.postDelayed(gattSetupTimeout, GATT_SETUP_TIMEOUT_MS);
        try {
            BluetoothGatt gatt = device.connectGatt(getContext(), false, gattClientCallback, BluetoothDevice.TRANSPORT_LE);
            if (gatt == null) {
                failGattSetup("Bluetooth refused the connection");
                return;
            }
            synchronized (linkLock) {
                clientGatt = gatt;
            }
        } catch (RuntimeException error) {
            failGattSetup(safe(error));
        }
    }

    @SuppressLint("MissingPermission")
    private void failGattSetup(String reason) {
        PluginCall call;
        BluetoothGatt gatt;
        synchronized (linkLock) {
            call = pendingConnect;
            pendingConnect = null;
            if (call == null) return;
            gatt = "gatt-client".equals(linkTransport) ? null : clientGatt;
            if (gatt != null) clientGatt = null;
        }
        if (gattSetupTimeout != null) mainHandler.removeCallbacks(gattSetupTimeout);
        gattSetupTimeout = null;
        if (gatt != null) {
            try { gatt.disconnect(); } catch (RuntimeException ignored) { /* gone */ }
            try { gatt.close(); } catch (RuntimeException ignored) { /* gone */ }
        }
        String l2cap = call.getString("l2capError", "");
        call.reject("Couldn't reach that phone. Make sure it's still on the Receive screen and close by. ("
            + reason + (l2cap == null || l2cap.isEmpty() ? "" : "; channel: " + l2cap) + ")");
    }

    private final BluetoothGattCallback gattClientCallback = new BluetoothGattCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try {
                    gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);
                    // Bigger packets = fewer round trips; discovery continues in onMtuChanged.
                    if (!gatt.requestMtu(517)) gatt.discoverServices();
                } catch (RuntimeException error) {
                    failGattSetup(safe(error));
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                if ("gatt-client".equals(linkTransport) && gatt == clientGatt) {
                    closeLink(linkGeneration, status == 8 ? "connection lost (out of range)" : "connection lost");
                } else {
                    failGattSetup("disconnected during setup (status " + status + ")");
                }
            }
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) linkMtu = mtu;
            if (!"gatt-client".equals(linkTransport)) {
                try {
                    if (!gatt.discoverServices()) failGattSetup("service discovery refused");
                } catch (RuntimeException error) {
                    failGattSetup(safe(error));
                }
            }
        }

        @Override
        @SuppressLint("MissingPermission")
        @SuppressWarnings("deprecation")
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            BluetoothGattService service = gatt.getService(SERVICE_UUID);
            BluetoothGattCharacteristic rx = service == null ? null : service.getCharacteristic(RX_UUID);
            BluetoothGattCharacteristic tx = service == null ? null : service.getCharacteristic(TX_UUID);
            if (rx == null || tx == null) {
                failGattSetup("the other phone needs the latest BlueGuardian");
                return;
            }
            clientRx = rx;
            try {
                gatt.setCharacteristicNotification(tx, true);
                BluetoothGattDescriptor cccd = tx.getDescriptor(CCCD_UUID);
                if (cccd == null) {
                    failGattSetup("notification descriptor missing");
                    return;
                }
                boolean started;
                if (Build.VERSION.SDK_INT >= 33) {
                    started = gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS;
                } else {
                    cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    started = gatt.writeDescriptor(cccd);
                }
                if (!started) failGattSetup("couldn't subscribe to the other phone");
            } catch (RuntimeException error) {
                failGattSetup(safe(error));
            }
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            if (!CCCD_UUID.equals(descriptor.getUuid())) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failGattSetup("the other phone is busy with another connection");
                return;
            }
            PluginCall call;
            synchronized (linkLock) {
                call = pendingConnect;
                pendingConnect = null;
            }
            if (gattSetupTimeout != null) mainHandler.removeCallbacks(gattSetupTimeout);
            gattSetupTimeout = null;
            if (call == null) return;
            startGattLink(gatt, null, "client");
            JSObject out = new JSObject();
            out.put("connected", true);
            out.put("transport", "gatt");
            out.put("mtu", linkMtu);
            call.resolve(out);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (TX_UUID.equals(characteristic.getUuid())) acceptInbound(characteristic.getValue(), linkGeneration);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (TX_UUID.equals(characteristic.getUuid())) acceptInbound(value, linkGeneration);
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            segmentOk = status == BluetoothGatt.GATT_SUCCESS;
            Semaphore ack = segmentAck;
            if (ack != null) ack.release();
        }

        @Override
        public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) emitPeerRssi(rssi);
        }
    };

    private void startGattLink(BluetoothGatt gatt, BluetoothDevice serverDevice, String role) {
        final int generation;
        String address;
        synchronized (linkLock) {
            if (linkTransport != null) return;
            linkTransport = gatt != null ? "gatt-client" : "gatt-server";
            clientGatt = gatt != null ? gatt : clientGatt;
            serverPeer = serverDevice;
            linkRole = role;
            generation = ++linkGeneration;
            synchronized (inbound) {
                inbound.reset();
            }
            address = gatt != null ? gatt.getDevice().getAddress() : serverDevice.getAddress();
        }
        if ("host".equals(role)) pauseAdvertising();
        JSObject state = new JSObject();
        state.put("state", "connected");
        state.put("role", role);
        state.put("address", address);
        state.put("transport", "gatt");
        notifyListeners("linkState", state);
        if (gatt != null) startRssiPoll(gatt, generation);
    }

    /** Reassembles the GATT byte stream into the same length-prefixed frames as L2CAP. */
    private void acceptInbound(byte[] value, int generation) {
        if (value == null || value.length == 0) return;
        List<byte[]> frames = new ArrayList<>();
        String error = null;
        synchronized (inbound) {
            inbound.write(value, 0, value.length);
            byte[] all = inbound.toByteArray();
            int pos = 0;
            while (all.length - pos >= 4) {
                int length = ((all[pos] & 0xff) << 24) | ((all[pos + 1] & 0xff) << 16) | ((all[pos + 2] & 0xff) << 8) | (all[pos + 3] & 0xff);
                if (length <= 0 || length > MAX_FRAME_BYTES) {
                    error = "peer sent an invalid frame size";
                    break;
                }
                if (all.length - pos - 4 < length) break;
                byte[] frame = new byte[length];
                System.arraycopy(all, pos + 4, frame, 0, length);
                frames.add(frame);
                pos += 4 + length;
            }
            inbound.reset();
            if (error == null && pos < all.length) inbound.write(all, pos, all.length - pos);
        }
        for (byte[] frame : frames) {
            JSObject event = new JSObject();
            event.put("data", Base64.encodeToString(frame, Base64.NO_WRAP));
            notifyListeners("linkFrame", event);
        }
        if (error != null) closeLink(generation, error);
    }

    /** Writes one length-prefixed frame as MTU-sized segments, each acknowledged by the stack. */
    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private boolean writeGattFrame(byte[] frame, int generation) {
        byte[] stream = new byte[frame.length + 4];
        stream[0] = (byte) (frame.length >>> 24);
        stream[1] = (byte) (frame.length >>> 16);
        stream[2] = (byte) (frame.length >>> 8);
        stream[3] = (byte) frame.length;
        System.arraycopy(frame, 0, stream, 4, frame.length);
        int segment = Math.max(20, Math.min(512, linkMtu - 3));
        for (int offset = 0; offset < stream.length; offset += segment) {
            byte[] part = java.util.Arrays.copyOfRange(stream, offset, Math.min(stream.length, offset + segment));
            String transport;
            BluetoothGatt gatt;
            BluetoothGattCharacteristic rx;
            BluetoothGattServer server;
            BluetoothGattCharacteristic tx;
            BluetoothDevice peer;
            synchronized (linkLock) {
                if (generation != linkGeneration || linkTransport == null) return false;
                transport = linkTransport;
                gatt = clientGatt;
                rx = clientRx;
                server = gattServer != null ? gattServer : pendingServerClose;
                tx = serverTx;
                peer = serverPeer;
            }
            Semaphore ack = new Semaphore(0);
            segmentAck = ack;
            segmentOk = false;
            boolean started = false;
            // The stack refuses a new operation while the previous one is still queued; retry briefly.
            for (int attempt = 0; attempt < 40 && !started; attempt++) {
                try {
                    if ("gatt-client".equals(transport) && gatt != null && rx != null) {
                        if (Build.VERSION.SDK_INT >= 33) {
                            started = gatt.writeCharacteristic(rx, part, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) == BluetoothGatt.GATT_SUCCESS;
                        } else {
                            rx.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                            rx.setValue(part);
                            started = gatt.writeCharacteristic(rx);
                        }
                    } else if ("gatt-server".equals(transport) && server != null && tx != null && peer != null) {
                        if (Build.VERSION.SDK_INT >= 33) {
                            started = server.notifyCharacteristicChanged(peer, tx, false, part) == BluetoothGatt.GATT_SUCCESS;
                        } else {
                            tx.setValue(part);
                            started = server.notifyCharacteristicChanged(peer, tx, false);
                        }
                    } else {
                        return false;
                    }
                } catch (RuntimeException error) {
                    started = false;
                }
                if (!started) {
                    try { Thread.sleep(25); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return false; }
                }
            }
            if (!started) return false;
            try {
                if (!ack.tryAcquire(SEGMENT_ACK_TIMEOUT_MS, TimeUnit.MILLISECONDS)) return false;
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
            if (!segmentOk) return false;
        }
        return true;
    }

    // ------------------------------------------------------------- link keeper

    /**
     * L2CAP links: open a GATT connection over the same Bluetooth link purely to ask for
     * high connection priority (short connection interval = faster, steadier transfers)
     * and to read the signal strength of the live connection. Replaces the old background
     * scan, which competed with the transfer for radio time and caused drops.
     */
    @SuppressLint("MissingPermission")
    private void startLinkKeeper(BluetoothDevice device, final int generation) {
        if (device == null) return;
        try {
            keeperGatt = device.connectGatt(getContext(), false, new BluetoothGattCallback() {
                @Override
                public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        try { gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH); } catch (RuntimeException ignored) { /* best effort */ }
                        startRssiPoll(gatt, generation);
                    }
                }

                @Override
                public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                    if (status == BluetoothGatt.GATT_SUCCESS) emitPeerRssi(rssi);
                }
            }, BluetoothDevice.TRANSPORT_LE);
        } catch (RuntimeException ignored) {
            keeperGatt = null;
        }
    }

    @SuppressLint("MissingPermission")
    private void startRssiPoll(final BluetoothGatt gatt, final int generation) {
        mainHandler.post(() -> {
            if (rssiPoll != null) mainHandler.removeCallbacks(rssiPoll);
            rssiPoll = new Runnable() {
                @Override
                public void run() {
                    if (generation != linkGeneration || linkTransport == null) return;
                    try { gatt.readRemoteRssi(); } catch (RuntimeException ignored) { /* link busy or gone */ }
                    mainHandler.postDelayed(this, 1000);
                }
            };
            mainHandler.postDelayed(rssiPoll, 800);
        });
    }

    private void emitPeerRssi(int rssi) {
        long now = System.currentTimeMillis();
        if (now - lastRssiEmit < RSSI_EMIT_INTERVAL_MS) return;
        lastRssiEmit = now;
        JSObject event = new JSObject();
        event.put("rssi", rssi);
        event.put("observedAt", now);
        notifyListeners("peerRssi", event);
    }

    @SuppressLint("MissingPermission")
    private void stopLinkKeeper() {
        if (rssiPoll != null) mainHandler.removeCallbacks(rssiPoll);
        rssiPoll = null;
        BluetoothGatt keeper = keeperGatt;
        keeperGatt = null;
        if (keeper != null) {
            try { keeper.disconnect(); } catch (RuntimeException ignored) { /* gone */ }
            try { keeper.close(); } catch (RuntimeException ignored) { /* gone */ }
        }
    }

    private void startLink(BluetoothSocket socket, String role) {
        final int generation;
        final InputStream in;
        try {
            in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();
            synchronized (linkLock) {
                if (linkTransport != null) {
                    closeQuietly(socket);
                    return;
                }
                linkSocket = socket;
                linkOut = new DataOutputStream(new java.io.BufferedOutputStream(out, 32 * 1024));
                linkRole = role;
                linkTransport = "l2cap";
                generation = ++linkGeneration;
            }
        } catch (IOException error) {
            closeQuietly(socket);
            return;
        }
        if ("host".equals(role)) pauseAdvertising();
        JSObject state = new JSObject();
        state.put("state", "connected");
        state.put("role", role);
        state.put("address", addressOf(socket));
        state.put("transport", "l2cap");
        notifyListeners("linkState", state);
        BluetoothDevice remote = null;
        try { remote = socket.getRemoteDevice(); } catch (RuntimeException ignored) { /* unknown */ }
        final BluetoothDevice keeperTarget = remote;
        final int keeperGeneration = generation;
        mainHandler.post(() -> startLinkKeeper(keeperTarget, keeperGeneration));
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
            String transport;
            synchronized (linkLock) {
                out = linkOut;
                generation = linkGeneration;
                transport = linkTransport;
            }
            if (transport == null) {
                call.reject("The secure link is not connected.");
                return;
            }
            if (!"l2cap".equals(transport)) {
                if (writeGattFrame(frame, generation)) {
                    call.resolve();
                } else {
                    call.reject("Sending failed: connection lost.");
                    closeLink(generation, "connection lost");
                }
                return;
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

    @SuppressLint("MissingPermission")
    private void closeLink(int generation, String reason) {
        BluetoothSocket socket;
        String role;
        String transport;
        BluetoothGatt gatt;
        BluetoothDevice peer;
        BluetoothGattServer server;
        BluetoothGattServer orphanServer;
        synchronized (linkLock) {
            if (generation != linkGeneration || linkTransport == null) return;
            socket = linkSocket;
            role = linkRole;
            transport = linkTransport;
            gatt = clientGatt;
            peer = serverPeer;
            server = gattServer;
            orphanServer = pendingServerClose;
            linkSocket = null;
            linkOut = null;
            linkRole = null;
            linkTransport = null;
            clientGatt = null;
            clientRx = null;
            serverPeer = null;
            pendingServerClose = null;
        }
        // Unblock a writer waiting for a segment acknowledgement.
        Semaphore ack = segmentAck;
        segmentOk = false;
        if (ack != null) ack.release();
        if (socket != null) closeQuietly(socket);
        if ("gatt-client".equals(transport) && gatt != null) {
            try { gatt.disconnect(); } catch (RuntimeException ignored) { /* gone */ }
            try { gatt.close(); } catch (RuntimeException ignored) { /* gone */ }
        }
        if ("gatt-server".equals(transport) && peer != null) {
            BluetoothGattServer s = server != null ? server : orphanServer;
            if (s != null) {
                try { s.cancelConnection(peer); } catch (RuntimeException ignored) { /* gone */ }
            }
        }
        if (orphanServer != null) {
            try { orphanServer.close(); } catch (RuntimeException ignored) { /* already closed */ }
        }
        stopLinkKeeper();
        if ("host".equals(role) && !"closed by user".equals(reason) && !"app closed".equals(reason)) resumeAdvertising();
        JSObject state = new JSObject();
        state.put("state", "closed");
        state.put("role", role);
        state.put("message", reason);
        notifyListeners("linkState", state);
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
