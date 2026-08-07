/**
 * Firebase Admin bootstrap.
 *
 * The orchestrator writes through the Admin SDK, which bypasses
 * firebase/firestore.rules entirely — that is what lets it write to
 * collections the rules mark client-read-only. Two credential sources are
 * accepted because .env.example documents both: a service account JSON
 * pasted inline (Vercel-friendly, no file to ship) or a path Application
 * Default Credentials can resolve.
 */

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

let app: App | null = null;

export function adminApp(): App {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0] as App;
    return app;
  }

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    app = initializeApp({ credential: cert(JSON.parse(inline)) });
    return app;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // initializeApp() with no credential resolves Application Default
    // Credentials from that path, exactly like every other Google SDK.
    app = initializeApp();
    return app;
  }

  throw new Error(
    'Firebase Admin is not configured: set FIREBASE_SERVICE_ACCOUNT_JSON (the service ' +
      'account JSON, as one line) or GOOGLE_APPLICATION_CREDENTIALS (a path to it) in the ' +
      'environment before starting the orchestrator. See .env.example.',
  );
}
