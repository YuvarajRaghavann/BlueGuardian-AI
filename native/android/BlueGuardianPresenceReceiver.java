package com.blueguardian.hybrid;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Records when each Bluetooth device connects to or disconnects from this phone,
 * even while BlueGuardian is closed (ACL broadcasts are exempt from Android's
 * implicit-broadcast limits and are protected: only the system can send them).
 *
 * On disconnect it also tries to save where the phone was — that is usually
 * where earbuds or a tag were dropped. Location is saved only when the user has
 * granted location permission; with "Allow all the time" it works with the app closed.
 */
public class BlueGuardianPresenceReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        boolean connected = BluetoothDevice.ACTION_ACL_CONNECTED.equals(action);
        boolean disconnected = BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action);
        if (!connected && !disconnected) return;
        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        if (device == null) return;
        final String address;
        String name = null;
        try {
            address = device.getAddress();
            name = device.getName();
        } catch (SecurityException error) {
            return;
        }
        if (address == null) return;
        final Context app = context.getApplicationContext();
        LastSeenStore.recordEvent(app, address, name, connected ? "connected" : "disconnected");

        final PendingResult pending = goAsync();
        LastSeenStore.captureLocation(app, 9000, location -> {
            if (location != null) {
                LastSeenStore.recordLocation(app, address, null, location, connected ? "connected" : "disconnected");
            }
            pending.finish();
        });
    }

    /** Small JSON store in SharedPreferences, shared by the receiver and the plugin. */
    public static final class LastSeenStore {
        private static final String PREFS = "blueguardian.last_seen.v1";
        private static final Object LOCK = new Object();

        public interface LocationCallback {
            void onLocation(Location location);
        }

        private LastSeenStore() {}

        static SharedPreferences prefs(Context context) {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        }

        static JSONObject read(Context context, String address) {
            String raw = prefs(context).getString(address.toUpperCase(), null);
            if (raw == null) return new JSONObject();
            try {
                return new JSONObject(raw);
            } catch (Exception error) {
                return new JSONObject();
            }
        }

        static void write(Context context, String address, JSONObject value) {
            prefs(context).edit().putString(address.toUpperCase(), value.toString()).apply();
        }

        public static void recordEvent(Context context, String address, String name, String event) {
            synchronized (LOCK) {
                try {
                    JSONObject entry = read(context, address);
                    long now = System.currentTimeMillis();
                    entry.put("address", address.toUpperCase());
                    if (name != null && !name.trim().isEmpty()) entry.put("name", name.trim());
                    entry.put("connected".equals(event) ? "lastConnectedAt" : "lastDisconnectedAt", now);
                    entry.put("lastSeenAt", now);
                    entry.put("lastSeenSource", event);
                    write(context, address, entry);
                } catch (Exception ignored) {
                    // never crash a broadcast
                }
            }
        }

        public static void recordSighting(Context context, String address, String name, String source, Integer rssi) {
            synchronized (LOCK) {
                try {
                    JSONObject entry = read(context, address);
                    long now = System.currentTimeMillis();
                    entry.put("address", address.toUpperCase());
                    if (name != null && !name.trim().isEmpty()) entry.put("name", name.trim());
                    entry.put("lastSeenAt", now);
                    entry.put("lastSeenSource", source);
                    if (rssi != null) entry.put("lastRssi", rssi);
                    write(context, address, entry);
                } catch (Exception ignored) {
                    // best effort
                }
            }
        }

        public static void recordLocation(Context context, String address, String name, Location location, String source) {
            synchronized (LOCK) {
                try {
                    JSONObject entry = read(context, address);
                    entry.put("address", address.toUpperCase());
                    if (name != null && !name.trim().isEmpty()) entry.put("name", name.trim());
                    JSONObject loc = new JSONObject();
                    loc.put("lat", location.getLatitude());
                    loc.put("lng", location.getLongitude());
                    loc.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1);
                    loc.put("fixAt", location.getTime());
                    loc.put("savedAt", System.currentTimeMillis());
                    loc.put("source", source);
                    entry.put("location", loc);
                    write(context, address, entry);
                } catch (Exception ignored) {
                    // best effort
                }
            }
        }

        public static JSONObject readAll(Context context) {
            JSONObject all = new JSONObject();
            synchronized (LOCK) {
                SharedPreferences prefs = prefs(context);
                Iterator<String> keys = prefs.getAll().keySet().iterator();
                while (keys.hasNext()) {
                    String key = keys.next();
                    try {
                        all.put(key, new JSONObject(prefs.getString(key, "{}")));
                    } catch (Exception ignored) {
                        // skip corrupt entry
                    }
                }
            }
            return all;
        }

        public static void forget(Context context, String address) {
            prefs(context).edit().remove(address.toUpperCase()).apply();
        }

        static boolean hasLocationPermission(Context context) {
            return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }

        /** A cached fix older than this is not "where it was left"; it is somewhere else entirely. */
        private static final long MAX_CACHED_AGE_MS = 15 * 60 * 1000L;

        /**
         * Fresh fix when possible, else a recent cached fix (never an hours-old one);
         * callback always runs exactly once. Prefers the fused/network providers, which
         * answer in a second or two indoors where GPS often never gets a fix.
         */
        @SuppressLint("MissingPermission")
        public static void captureLocation(Context context, long timeoutMs, LocationCallback callback) {
            final AtomicBoolean done = new AtomicBoolean(false);
            final Handler main = new Handler(Looper.getMainLooper());
            if (!hasLocationPermission(context)) {
                callback.onLocation(null);
                return;
            }
            final LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (manager == null) {
                callback.onLocation(null);
                return;
            }
            final Location newest = newestCached(manager);
            final Location cached = newest != null && System.currentTimeMillis() - newest.getTime() <= MAX_CACHED_AGE_MS ? newest : null;
            final Runnable fallback = () -> {
                if (done.compareAndSet(false, true)) callback.onLocation(cached);
            };
            main.postDelayed(fallback, timeoutMs);
            String provider = null;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.hasProvider(LocationManager.FUSED_PROVIDER)
                    && manager.isProviderEnabled(LocationManager.FUSED_PROVIDER)) provider = LocationManager.FUSED_PROVIDER;
                else if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) provider = LocationManager.NETWORK_PROVIDER;
                else if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) provider = LocationManager.GPS_PROVIDER;
            } catch (Exception ignored) {
                // provider state unavailable
            }
            if (provider == null) {
                main.removeCallbacks(fallback);
                fallback.run();
                return;
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    manager.getCurrentLocation(provider, new CancellationSignal(), context.getMainExecutor(), location -> {
                        if (done.compareAndSet(false, true)) {
                            main.removeCallbacks(fallback);
                            callback.onLocation(location != null ? location : cached);
                        }
                    });
                } else {
                    manager.requestSingleUpdate(provider, new android.location.LocationListener() {
                        @Override
                        public void onLocationChanged(Location location) {
                            if (done.compareAndSet(false, true)) {
                                main.removeCallbacks(fallback);
                                callback.onLocation(location != null ? location : cached);
                            }
                        }

                        @Override
                        public void onStatusChanged(String p, int status, android.os.Bundle extras) {}

                        @Override
                        public void onProviderEnabled(String p) {}

                        @Override
                        public void onProviderDisabled(String p) {}
                    }, Looper.getMainLooper());
                }
            } catch (Exception error) {
                main.removeCallbacks(fallback);
                fallback.run();
            }
        }

        @SuppressLint("MissingPermission")
        static Location newestCached(LocationManager manager) {
            Location best = null;
            try {
                for (String provider : manager.getProviders(true)) {
                    Location l = manager.getLastKnownLocation(provider);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                }
            } catch (Exception ignored) {
                // background or permission limits
            }
            return best;
        }
    }
}
