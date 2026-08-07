/**
 * Firebase client.
 *
 * These config values are public by design — they ship in the browser bundle
 * and identify the project without authorising anything. Access is controlled
 * by the security rules in `firebase/firestore.rules`, not by hiding the key.
 */

import { type FirebaseApp, type FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { type Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

/**
 * Read the config, or return null when it is absent.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time, so each name must
 * appear literally rather than being looked up in a loop. Returning null
 * rather than a partially-filled object means callers cannot accidentally
 * initialise Firebase with undefined values.
 */
function readConfig(): FirebaseOptions | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !appId) return null;
  // storageBucket and messagingSenderId are genuinely optional. Under
  // exactOptionalPropertyTypes they must be omitted rather than set to
  // undefined, which is the distinction that setting matters for.
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    ...(storageBucket ? { storageBucket } : {}),
    ...(messagingSenderId ? { messagingSenderId } : {}),
  };
}

const config = readConfig();

/**
 * Whether the app is configured at all.
 *
 * Checked explicitly so a missing `.env.local` produces a clear message in the
 * UI rather than an opaque Firebase initialisation error.
 */
export const firebaseConfigured = config !== null;

export function firebaseApp(): FirebaseApp {
  if (!config) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to apps/web/.env.local and fill in the ' +
        'NEXT_PUBLIC_FIREBASE_* values.',
    );
  }
  return getApps().length > 0 ? getApp() : initializeApp(config);
}

/**
 * Local emulator host, e.g. "127.0.0.1" — set NEXT_PUBLIC_EMULATOR_HOST to
 * point this app at `firebase emulators:start` instead of the real project.
 *
 * Opt-in and absent from production builds by construction: the variable is
 * inlined at build time, so a deployed bundle built without it cannot be
 * talked into connecting to a developer's machine. Guarded against
 * double-connecting because Next's fast refresh re-runs module code while the
 * FirebaseApp instance survives, and connect*Emulator throws on a second call.
 */
const EMULATOR_HOST = process.env.NEXT_PUBLIC_EMULATOR_HOST;
let emulatorsConnected = false;

export function firebaseAuth(): Auth {
  const auth = getAuth(firebaseApp());
  if (EMULATOR_HOST && !emulatorsConnected) {
    emulatorsConnected = true;
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(getFirestore(firebaseApp()), EMULATOR_HOST, 8080);
  }
  return auth;
}

export function firestore(): Firestore {
  // Routed through firebaseAuth() so the emulator wiring happens exactly once
  // regardless of which of the two a screen reaches for first.
  if (EMULATOR_HOST && !emulatorsConnected) firebaseAuth();
  return getFirestore(firebaseApp());
}
