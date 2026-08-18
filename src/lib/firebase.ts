import { getAnalytics, isSupported } from 'firebase/analytics';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Configuração pública oficial já usada pelo Froc.IA antes do upgrade.
// Firebase Web config não é segredo. As VITE_* só são usadas quando apontam
// para o MESMO projeto e estão completas, evitando frontend/backend em projetos diferentes.
const officialFirebaseConfig = {
  apiKey: 'AIzaSyDeI9RmYSjVK-P17wdMIfOQMDCDHvw_tqA',
  authDomain: 'froc-ia-marketing-engine.firebaseapp.com',
  projectId: 'froc-ia-marketing-engine',
  storageBucket: 'froc-ia-marketing-engine.firebasestorage.app',
  messagingSenderId: '181875125724',
  appId: '1:181875125724:web:6669d62b4b8bec5c60b319',
  measurementId: 'G-1P1E1TSDQ6'
} as const;

const envFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined
};

const envIsComplete = Boolean(
  envFirebaseConfig.apiKey &&
  envFirebaseConfig.authDomain &&
  envFirebaseConfig.projectId &&
  envFirebaseConfig.storageBucket &&
  envFirebaseConfig.messagingSenderId &&
  envFirebaseConfig.appId
);

const envMatchesOfficialProject = envFirebaseConfig.projectId === officialFirebaseConfig.projectId;

if (envIsComplete && !envMatchesOfficialProject) {
  console.warn(
    `[Froc Firebase] VITE_FIREBASE_PROJECT_ID (${envFirebaseConfig.projectId}) não corresponde ao projeto oficial (${officialFirebaseConfig.projectId}). Usando configuração oficial para preservar a autenticação.`
  );
}

const firebaseConfig = envIsComplete && envMatchesOfficialProject
  ? envFirebaseConfig
  : officialFirebaseConfig;

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export const firebaseProjectId = firebaseConfig.projectId;

export let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
  isSupported().then((supported) => {
    if (supported) analytics = getAnalytics(app);
  }).catch(() => undefined);
}
