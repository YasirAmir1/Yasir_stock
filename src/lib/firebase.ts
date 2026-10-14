import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const databaseId =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : undefined;

let firestoreDb;
try {
  firestoreDb = databaseId
    ? initializeFirestore(app, { experimentalForceLongPolling: true }, databaseId)
    : initializeFirestore(app, { experimentalForceLongPolling: true });
} catch (e) {
  firestoreDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

export const db = firestoreDb;
