#!/usr/bin/env -S node --import tsx
/**
 * Self-check for Firebase Admin credentials.
 *
 * This is the one thing this session could not do: FIREBASE_SERVICE_ACCOUNT_JSON
 * was empty in every .env* file found locally, and generating one requires
 * either the Firebase console (Project settings > Service accounts > Generate
 * new private key) or `gcloud`, which was not available in this environment.
 * Run this the moment you add the credential — it writes and immediately
 * deletes one throwaway document, so a clean pass means worker.ts and
 * server.ts will actually be able to write.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from './admin.js';

async function main(): Promise<void> {
  console.log('[verify] initialising Firebase Admin...');
  const app = adminApp();
  console.log(`[verify] Admin SDK initialised for project "${app.options.projectId}".`);

  const db = getFirestore(app);
  const probe = db.collection('_orchestrator_verify').doc(`probe-${Date.now()}`);

  console.log('[verify] writing a throwaway document...');
  await probe.set({ at: Date.now() });
  console.log('[verify] write ok.');

  const snap = await probe.get();
  if (!snap.exists) throw new Error('wrote a document but the read-back found nothing');
  console.log('[verify] read-back ok.');

  await probe.delete();
  console.log('[verify] cleanup ok.');

  console.log(
    '\n[verify] Firebase Admin credentials are working. `pnpm run worker` and `pnpm run ' +
      'serve` should be able to write real runs now.',
  );
}

void main().catch((error: unknown) => {
  console.error('\n[verify] FAILED:', error);
  console.error(
    '\nCheck FIREBASE_SERVICE_ACCOUNT_JSON (the service account JSON as one line) or ' +
      'GOOGLE_APPLICATION_CREDENTIALS (a path to it) is set — see .env.example and ' +
      'services/orchestrator/README.md.',
  );
  process.exitCode = 1;
});
