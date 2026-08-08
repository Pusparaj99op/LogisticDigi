#!/usr/bin/env -S node --import tsx
/**
 * Self-check for the Zerion Wallet API, mirroring verify-llm.ts's pattern:
 * makes one real call through zerion/client.ts and reports plainly whether
 * it actually answered — not assumed from the code compiling.
 */

import { zerionClientFromEnv } from './zerion/client.js';

async function main(): Promise<void> {
  const apiKey = process.env.ZERION_API_KEY;
  if (!apiKey) {
    console.log('[verify-zerion] ZERION_API_KEY not set — the Settlement agent will skip the check.');
    process.exitCode = 1;
    return;
  }

  const wallet = process.env.ZERION_DEMO_WALLET || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const client = zerionClientFromEnv();

  try {
    const summary = await client.getPortfolioSummary(wallet);
    console.log('[verify-zerion] Zerion OK:', JSON.stringify(summary));
  } catch (cause) {
    console.error('[verify-zerion] Zerion FAILED:', (cause as Error).message);
    process.exitCode = 1;
  }
}

void main();
