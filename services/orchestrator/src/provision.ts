#!/usr/bin/env -S node --import tsx
/**
 * Assigns a signed-up user to a tenant.
 *
 * firebase/firestore.rules gates every read on the caller's `tenantId` and
 * `role` custom claims, and apps/web's live.ts queries return nothing at all
 * until `session.tenantId` is non-null (see apps/web/src/components/live.ts).
 * Nothing else in this repo sets those claims — there is no signup-time
 * tenant assignment yet, in any phase — so a freshly created account can
 * sign in but will never see a run, an approval, or a ledger entry no matter
 * what the orchestrator writes. This script is the manual stand-in for that
 * missing piece: run it once per operator to point their account at a
 * tenant. A real product would do this from a Cloud Function on user
 * creation or an invite flow instead of a CLI a human has to remember to run.
 *
 * Usage:
 *   pnpm --filter @logisticdigi/orchestrator run provision -- \
 *     --email you@example.com --tenant tenant_a --role owner [--platform-owner]
 */

import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from './admin.js';

interface Args {
  readonly email: string;
  readonly tenant: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly platformOwner: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const email = get('--email');
  const tenant = get('--tenant');
  const role = (get('--role') ?? 'member') as Args['role'];
  if (!email || !tenant) {
    throw new Error(
      'usage: provision --email <email> --tenant <tenantId> [--role owner|admin|member] [--platform-owner]',
    );
  }
  if (!['owner', 'admin', 'member'].includes(role)) {
    throw new Error(`--role must be owner, admin, or member; received "${role}"`);
  }
  return { email, tenant, role, platformOwner: argv.includes('--platform-owner') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const app = adminApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  const user = await auth.getUserByEmail(args.email);
  await auth.setCustomUserClaims(user.uid, {
    tenantId: args.tenant,
    role: args.role,
    platformOwner: args.platformOwner,
  });

  // Server-side write, bypassing the client-closed create/delete rule on
  // /tenants/{tenantId} — see firebase/firestore.rules.
  await db
    .collection('tenants')
    .doc(args.tenant)
    .set(
      { name: args.tenant, createdAt: Date.now() },
      { merge: true },
    );

  console.log(
    `[provision] ${args.email} (${user.uid}) is now ${args.role} of "${args.tenant}"` +
      (args.platformOwner ? ', with platform-owner access' : ''),
  );
  console.log(
    '[provision] the claim takes effect on next sign-in, or immediately if the app is ' +
      'already open and calls getIdToken(true).',
  );
}

void main().catch((error: unknown) => {
  console.error('[provision] failed:', error);
  process.exitCode = 1;
});
