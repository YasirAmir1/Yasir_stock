import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  initializeFirestore, 
  getFirestore, 
  memoryLocalCache 
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const databaseId =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : undefined;

let firestoreDb;
try {
  const cacheSettings = {
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: true,
  };
  firestoreDb = databaseId
    ? initializeFirestore(app, cacheSettings, databaseId)
    : initializeFirestore(app, cacheSettings);
} catch (e) {
  try {
    firestoreDb = databaseId
      ? initializeFirestore(app, { experimentalForceLongPolling: true }, databaseId)
      : initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch (e2) {
    firestoreDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
}

export const db = firestoreDb;
export const storage = getStorage(app);

