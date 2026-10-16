import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeBleObservation {
  id: string;
  address?: string;
  name?: string;
  rssi?: number;
  serviceUuids?: string[];
  connectable?: boolean;
  observedAt: number;
}

interface NativeBleScanState {
  state: 'scanning' | 'complete' | 'error';
  devicesFound?: number;
  durationMs?: number;
  message?: string;
  code?: number;
}

interface BlueGuardianBluetoothPlugin {
  startBleScan(options: { durationMs: number }): Promise<{ started: boolean; durationMs: number }>;
  stopBleScan(): Promise<{ stopped: boolean }>;
  addListener(eventName: 'deviceFound', listenerFunc: (event: NativeBleObservation) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'scanState', listenerFunc: (event: NativeBleScanState) => void): Promise<PluginListenerHandle>;
}

const nativeBluetooth = registerPlugin<BlueGuardianBluetoothPlugin>('BlueGuardianBluetooth');

export function isNativeAndroidApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export type NativeBleScanOutcome =
  | { ok: true; devicesFound: number; durationMs: number; message?: string }
  | { ok: false; error: string };

export async function scanNativeAndroidBle(
  onObservation: (observation: NativeBleObservation) => void,
  requestedDurationMs = 12000,
): Promise<NativeBleScanOutcome> {
  if (!isNativeAndroidApp()) {
    return { ok: false, error: 'Native Android Bluetooth scanning is only available inside the BlueGuardian APK.' };
  }

  const durationMs = Math.min(30000, Math.max(3000, Math.round(requestedDurationMs)));
  const observedIds = new Set<string>();
  let deviceListener: PluginListenerHandle | undefined;
  let stateListener: PluginListenerHandle | undefined;
  let safetyTimeout: ReturnType<typeof setTimeout> | undefined;
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;
  let resolveCompletion: (state: NativeBleScanState) => void = () => undefined;
  const completion = new Promise<NativeBleScanState>((resolve) => {
    resolveCompletion = resolve;
  });

  try {
    deviceListener = await nativeBluetooth.addListener('deviceFound', (observation) => {
      const identity = String(observation.address || observation.id || '').trim();
      if (!identity) return;
      observedIds.add(identity);
      onObservation({
        ...observation,
        id: identity,
        serviceUuids: Array.isArray(observation.serviceUuids) ? observation.serviceUuids : [],
        observedAt: typeof observation.observedAt === 'number' ? observation.observedAt : Date.now(),
      });
    });

    stateListener = await nativeBluetooth.addListener('scanState', (state) => {
      if (state.state === 'complete' || state.state === 'error') resolveCompletion(state);
    });

    // Guard the startup call as well as the scan window. A native permission/bridge
    // call that never settles must not leave the Devices page spinning forever.
    const started = await Promise.race([
      nativeBluetooth.startBleScan({ durationMs }),
      new Promise<never>((_resolve, reject) => {
        startupTimeout = setTimeout(() => {
          reject(new Error(
            'Android BLE scanner did not acknowledge the scan within 10 seconds. Check Nearby Devices permission and native plugin registration.',
          ));
        }, 10000);
      }),
    ]);
    if (startupTimeout) {
      clearTimeout(startupTimeout);
      startupTimeout = undefined;
    }
    const actualDurationMs = Math.min(30000, Math.max(3000, started.durationMs || durationMs));
    const timeout = new Promise<NativeBleScanState>((resolve) => {
      safetyTimeout = setTimeout(() => resolve({
        state: 'complete',
        devicesFound: observedIds.size,
        durationMs: actualDurationMs,
        message: 'The safety timeout ended the scan window because Android did not send a final scanner event.',
      }), actualDurationMs + 2500);
    });
    const finalState = await Promise.race([completion, timeout]);

    if (finalState.state === 'error') {
      return { ok: false, error: finalState.message || 'The Android BLE scanner reported an error.' };
    }

    const devicesFound = typeof finalState.devicesFound === 'number' ? finalState.devicesFound : observedIds.size;
    return {
      ok: true,
      devicesFound,
      durationMs: actualDurationMs,
      message: devicesFound === 0
        ? 'No BLE advertisements were received during this scan window. Keep the target nearby, ensure it is advertising, and retry.'
        : finalState.message,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown native Bluetooth error.';
    return { ok: false, error: message };
  } finally {
    if (safetyTimeout) clearTimeout(safetyTimeout);
    if (startupTimeout) clearTimeout(startupTimeout);
    try {
      await nativeBluetooth.stopBleScan();
    } catch {
      // The scan may already have stopped due to a permission error or lifecycle change.
    }
    try {
      await deviceListener?.remove();
    } catch {
      // Cleanup must not mask the scan result.
    }
    try {
      await stateListener?.remove();
    } catch {
      // Cleanup must not mask the scan result.
    }
  }
}
