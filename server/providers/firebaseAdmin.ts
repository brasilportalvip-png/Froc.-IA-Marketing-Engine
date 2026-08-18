import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { config } from '../config/index.js';

let adminApp: App | null = null;
let firestoreConfigured = false;

export function getFirebaseAdmin(): App {
  if (adminApp) return adminApp;
  const existing = getApps()[0];
  if (existing) {
    adminApp = existing;
    return adminApp;
  }

  if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
    throw new Error('Firebase Admin não configurado. Defina FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL e FIREBASE_ADMIN_PRIVATE_KEY.');
  }

  adminApp = initializeApp({
    credential: cert({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey
    }),
    projectId: config.firebase.projectId,
    storageBucket: `${config.firebase.projectId}.firebasestorage.app`
  });

  return adminApp;
}

export function getAdminFirestore(): Firestore {
  const firestore = getFirestore(getFirebaseAdmin());
  if (!firestoreConfigured) {
    firestore.settings({ ignoreUndefinedProperties: true });
    firestoreConfigured = true;
  }
  return firestore;
}

export function getAdminAuth(): Auth {
  return getAuth(getFirebaseAdmin());
}

export function getAdminStorage(): Storage {
  return getStorage(getFirebaseAdmin());
}
