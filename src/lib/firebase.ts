import { Capacitor } from '@capacitor/core';
import {
  getAnalytics,
  isSupported,
  setAnalyticsCollectionEnabled,
  type Analytics
} from 'firebase/analytics';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase Web config identifica o projeto público do frontend e não contém
// credenciais administrativas. Segredos continuam exclusivamente no backend.
const officialFirebaseConfig = {
  apiKey: 'AIzaSyDeI9RmYSjVK-P17wdMIfOQMDCDHvw_tqA',
  authDomain: 'froc-ia-marketing-engine.firebaseapp.com',
  projectId: 'froc-ia-marketing-engine',
  storageBucket: 'froc-ia-marketing-engine.firebasestorage.app',
  messagingSenderId: '181875125724',
  appId: '1:181875125724:web:6669d62b4b8bec5c60b319',
  measurementId: 'G-1P1E1TSDQ6'
} as const;

const rawEnvFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined
};

const requiredEnvFields = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId'
] as const;

const providedEnvFields = requiredEnvFields.filter((field) =>
  Boolean(String(rawEnvFirebaseConfig[field] || '').trim())
);
const envHasAnyRequiredField = providedEnvFields.length > 0;
const envIsComplete = providedEnvFields.length === requiredEnvFields.length;

if (envHasAnyRequiredField && !envIsComplete) {
  const missing = requiredEnvFields.filter(
    (field) => !providedEnvFields.includes(field)
  );

  throw new Error(
    `[Froc Firebase] Configuração VITE_FIREBASE_* incompleta. Campos ausentes: ${missing.join(', ')}.`
  );
}

if (envIsComplete) {
  const identityFields = [
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId'
  ] as const;

  const mismatches = identityFields.filter(
    (field) => rawEnvFirebaseConfig[field] !== officialFirebaseConfig[field]
  );

  if (mismatches.length > 0) {
    throw new Error(
      `[Froc Firebase] Configuração rejeitada: os campos ${mismatches.join(', ')} não pertencem ao projeto oficial.`
    );
  }
}

const firebaseConfig = envIsComplete
  ? {
      apiKey: rawEnvFirebaseConfig.apiKey!,
      authDomain: rawEnvFirebaseConfig.authDomain!,
      projectId: rawEnvFirebaseConfig.projectId!,
      storageBucket: rawEnvFirebaseConfig.storageBucket!,
      messagingSenderId: rawEnvFirebaseConfig.messagingSenderId!,
      appId: rawEnvFirebaseConfig.appId!,
      measurementId: rawEnvFirebaseConfig.measurementId
    }
  : officialFirebaseConfig;

const existingApp = getApps().length > 0 ? getApp() : null;

if (
  existingApp?.options.projectId &&
  existingApp.options.projectId !== firebaseConfig.projectId
) {
  throw new Error(
    '[Froc Firebase] Já existe uma instância Firebase ligada a outro projeto.'
  );
}

export const app = existingApp || initializeApp(firebaseConfig);

export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, {
      persistence: indexedDBLocalPersistence
    })
  : getAuth(app);

auth.languageCode = 'pt-BR';

export const db = getFirestore(app);

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({
  prompt: 'select_account'
});

export const firebaseProjectId = firebaseConfig.projectId;

const ANALYTICS_CONSENT_KEY = 'froc.analytics.consent.v1';

type StoredAnalyticsConsent = 'granted' | 'denied' | 'unknown';

export let analytics: Analytics | null = null;
let analyticsInitialization: Promise<Analytics | null> | null = null;

function readStoredAnalyticsConsent(): StoredAnalyticsConsent {
  if (typeof window === 'undefined') return 'unknown';

  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

function storeAnalyticsConsent(
  value: Exclude<StoredAnalyticsConsent, 'unknown'>
): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  } catch {
    // Em navegadores que bloqueiam armazenamento,
    // a decisão vale apenas na sessão atual.
  }
}

async function initializeAnalyticsAfterConsent(): Promise<Analytics | null> {
  if (typeof window === 'undefined' || !firebaseConfig.measurementId) {
    return null;
  }

  if (analytics) return analytics;
  if (analyticsInitialization) return analyticsInitialization;

  analyticsInitialization = (async () => {
    try {
      if (!(await isSupported())) return null;

      const instance = getAnalytics(app);
      setAnalyticsCollectionEnabled(instance, true);
      analytics = instance;

      return instance;
    } catch {
      return null;
    } finally {
      analyticsInitialization = null;
    }
  })();

  return analyticsInitialization;
}

/**
 * Único ponto autorizado para ativar ou revogar métricas opcionais.
 * Sem uma chamada explícita com `true`, o Analytics permanece desligado.
 */
export async function setFrocAnalyticsConsent(
  granted: boolean
): Promise<Analytics | null> {
  storeAnalyticsConsent(granted ? 'granted' : 'denied');

  if (!granted) {
    if (analytics) {
      setAnalyticsCollectionEnabled(analytics, false);
    }

    return null;
  }

  return initializeAnalyticsAfterConsent();
}

export function hasFrocAnalyticsConsent(): boolean {
  return readStoredAnalyticsConsent() === 'granted';
}

// Reativa somente uma decisão positiva salva anteriormente. Primeiro acesso,
// ausência de consentimento ou armazenamento indisponível mantêm coleta desligada.
if (hasFrocAnalyticsConsent()) {
  void initializeAnalyticsAfterConsent();
}