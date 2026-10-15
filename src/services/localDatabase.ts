import type {
  BluetoothDevice,
  DiscoverySource,
  SecurityAction,
  SecurityAssessment,
  Threat,
} from '../types';
import { needsManualApproval } from '../utils/connectionPolicy';

export const LOCAL_DATABASE_NAME = 'blueguardian-local';
const LOCAL_DATABASE_VERSION = 1;

export interface StoredAssessment {
  deviceId: string;
  assessment: SecurityAssessment;
  analyzedAt: Date;
  discoverySource: DiscoverySource;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function createStore(
  database: IDBDatabase,
  upgradeTransaction: IDBTransaction,
  name: string,
  keyPath: string,
  indexes: string[] = [],
): void {
  const store = database.objectStoreNames.contains(name)
    ? upgradeTransaction.objectStore(name)
    : database.createObjectStore(name, { keyPath });

  for (const index of indexes) {
    if (!store.indexNames.contains(index)) {
      store.createIndex(index, index, { unique: false });
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    factory = undefined;
  }

  if (!factory) {
    return Promise.reject(
      new Error('IndexedDB is unavailable. BlueGuardian can continue for this session, but local records cannot be saved.'),
    );
  }

  let opening: Promise<IDBDatabase>;
  opening = new Promise((resolve, reject) => {
    const request = factory.open(LOCAL_DATABASE_NAME, LOCAL_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const upgradeTransaction = request.transaction;
      if (!upgradeTransaction) throw new Error('IndexedDB upgrade transaction is unavailable.');
      createStore(database, upgradeTransaction, 'devices', 'id');
      createStore(database, upgradeTransaction, 'actions', 'id', ['deviceId', 'timestamp']);
      createStore(database, upgradeTransaction, 'threats', 'id', ['deviceId', 'status']);
      createStore(database, upgradeTransaction, 'assessments', 'deviceId');
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        if (databasePromise === opening) databasePromise = undefined;
      };
      resolve(database);
    };

    request.onerror = () => reject(new Error('Could not open BlueGuardian local storage.'));
    request.onblocked = () => reject(new Error('BlueGuardian local storage upgrade is blocked by another open tab.'));
  });

  databasePromise = opening;
  return opening;
}

function normalizePersistedDevice(device: BluetoothDevice): BluetoothDevice {
  return {
    ...device,
    blocked: Boolean(device.blocked),
    approvalRequired: needsManualApproval(device),
  };
}

function restorePersistedDevice(device: BluetoothDevice): BluetoothDevice {
  return {
    ...normalizePersistedDevice(device),
    connectionStatus: 'unknown',
    gattConnected: undefined,
    connectionHealth: undefined,
  };
}

function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  return openDatabase().then(database => new Promise<T | undefined>((resolve, reject) => {
    let result: T | undefined;
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    let tx: IDBTransaction | undefined;
    try {
      tx = database.transaction(stores, mode);
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.onerror = () => fail('BlueGuardian local storage operation failed.');
      tx.onabort = () => fail('BlueGuardian local storage operation was aborted.');

      const request = operation(tx);
      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => fail('BlueGuardian local storage request failed.');
      }
    } catch {
      try {
        tx?.abort();
      } catch {
        // The transaction may already be inactive.
      }
      fail('BlueGuardian local storage operation could not be started.');
    }
  }));
}

export const localDatabase = {
  async listDevices(): Promise<BluetoothDevice[]> {
    const devices = (await transaction<BluetoothDevice[]>(['devices'], 'readonly', tx =>
      tx.objectStore('devices').getAll(),
    )) ?? [];
    return devices.map(restorePersistedDevice);
  },

  async getDevice(deviceId: string): Promise<BluetoothDevice | undefined> {
    const device = await transaction<BluetoothDevice>(['devices'], 'readonly', tx =>
      tx.objectStore('devices').get(deviceId),
    );
    return device ? restorePersistedDevice(device) : undefined;
  },

  async saveDevice(device: BluetoothDevice): Promise<void> {
    // Demo records are deliberately session-only so they cannot be mistaken for
    // physical hardware after a reload or during troubleshooting.
    if (device.discoverySource === 'SIMULATED') return;
    const normalized = normalizePersistedDevice(device);
    await transaction(['devices'], 'readwrite', tx => {
      tx.objectStore('devices').put(normalized);
      return undefined;
    });
  },

  async saveDevices(devices: BluetoothDevice[]): Promise<void> {
    const physicalDevices = devices.filter(device => device.discoverySource !== 'SIMULATED');
    if (physicalDevices.length === 0) return;
    const normalized = physicalDevices.map(normalizePersistedDevice);
    await transaction(['devices'], 'readwrite', tx => {
      const store = tx.objectStore('devices');
      normalized.forEach(device => store.put(device));
      return undefined;
    });
  },

  /**
   * One-time migration for simulated records saved by older app versions.
   * Real device records and all other stores remain untouched.
   */
  async removeSimulatedDevices(): Promise<number> {
    const database = await openDatabase();
    return new Promise<number>((resolve, reject) => {
      let removed = 0;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error('Could not remove old simulated device records.'));
      };

      let tx: IDBTransaction;
      try {
        tx = database.transaction(['devices'], 'readwrite');
        const request = tx.objectStore('devices').openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const stored = cursor.value as Partial<BluetoothDevice>;
          if (stored.discoverySource === 'SIMULATED') {
            cursor.delete();
            removed += 1;
          }
          cursor.continue();
        };
        request.onerror = () => fail(new Error('Could not inspect stored device records for simulation data.'));
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(removed);
        };
        tx.onerror = () => fail(new Error('Could not remove old simulated device records.'));
        tx.onabort = () => fail(new Error('Removal of old simulated device records was aborted.'));
      } catch (error) {
        fail(error);
      }
    });
  },

  async listActions(): Promise<SecurityAction[]> {
    const actions = (await transaction<SecurityAction[]>(['actions'], 'readonly', tx =>
      tx.objectStore('actions').getAll(),
    )) ?? [];
    return actions.sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());
  },

  async recordSecurityAction(
    action: SecurityAction,
    device?: BluetoothDevice | null,
  ): Promise<void> {
    await transaction(['actions', 'devices'], 'readwrite', tx => {
      tx.objectStore('actions').put(action);
      if (device === null) tx.objectStore('devices').delete(action.deviceId);
      else if (device && device.discoverySource !== 'SIMULATED') {
        tx.objectStore('devices').put(normalizePersistedDevice(device));
      }
      return undefined;
    });
  },

  async listThreats(): Promise<Threat[]> {
    return (await transaction<Threat[]>(['threats'], 'readonly', tx =>
      tx.objectStore('threats').getAll(),
    )) ?? [];
  },

  async replaceThreats(threats: Threat[]): Promise<void> {
    await transaction(['threats'], 'readwrite', tx => {
      const store = tx.objectStore('threats');
      store.clear();
      threats.forEach(threat => store.put(threat));
      return undefined;
    });
  },

  async listAssessments(): Promise<StoredAssessment[]> {
    return (await transaction<StoredAssessment[]>(['assessments'], 'readonly', tx =>
      tx.objectStore('assessments').getAll(),
    )) ?? [];
  },

  async saveAssessments(assessments: StoredAssessment[]): Promise<void> {
    if (assessments.length === 0) return;
    await transaction(['assessments'], 'readwrite', tx => {
      const store = tx.objectStore('assessments');
      assessments.forEach(assessment => store.put(assessment));
      return undefined;
    });
  },

  async close(): Promise<void> {
    const current = databasePromise;
    databasePromise = undefined;
    if (!current) return;
    try {
      (await current).close();
    } catch {
      // There may be no open database if initialization failed.
    }
  },
};