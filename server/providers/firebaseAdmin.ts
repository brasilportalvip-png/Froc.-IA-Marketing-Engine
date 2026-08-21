import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { config } from '../config/index.js';

let adminApp: App | null = null;
let firestoreConfigured = false;

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey);
}

export function getFirebaseAdmin(): App | null {
  if (adminApp) return adminApp;
  const existing = getApps()[0];
  if (existing) {
    adminApp = existing;
    return adminApp;
  }

  if (!isFirebaseAdminConfigured()) {
    return null;
  }

  try {
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
  } catch (err: any) {
    return null;
  }
}

export function getAdminFirestore(): Firestore | null {
  const app = getFirebaseAdmin();
  if (!app) return null;
  try {
    const firestore = getFirestore(app);
    if (!firestoreConfigured) {
      firestore.settings({ ignoreUndefinedProperties: true });
      firestoreConfigured = true;
    }
    return firestore;
  } catch {
    return null;
  }
}

let overrideAdminAuth: Auth | null | undefined = undefined;

export function setAdminAuthForTesting(mockAuth: Auth | null | undefined): void {
  overrideAdminAuth = mockAuth;
}

export function getAdminAuth(): Auth | null {
  if (overrideAdminAuth !== undefined) return overrideAdminAuth;
  const app = getFirebaseAdmin();
  if (!app) return null;
  try {
    return getAuth(app);
  } catch {
    return null;
  }
}

let overrideAdminStorage: Storage | null | undefined = undefined;

export function setAdminStorageForTesting(mockStorage: Storage | null | undefined): void {
  overrideAdminStorage = mockStorage;
}

export function getAdminStorage(): Storage | null {
  if (overrideAdminStorage !== undefined) return overrideAdminStorage;
  const app = getFirebaseAdmin();
  if (!app) return null;
  try {
    return getStorage(app);
  } catch {
    return null;
  }
}

