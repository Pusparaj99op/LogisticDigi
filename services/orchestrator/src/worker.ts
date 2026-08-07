#!/usr/bin/env -S node --import tsx
/**
 * The local/hosted worker: one long-lived process, ticking on an interval.
 *
 * This is the "local worker" .env.example's RUNNER_ID and
 * WORKER_SHARED_SECRET anticipate. Run it with `pnpm --filter
 * @logisticdigi/orchestrator run worker` and it drives demo runs against
 * Firestore until stopped.
 */

import { FirestoreStore } from './firestore-store.js';
import { Orchestrator } from './tick.js';

const TICK_INTERVAL_MS = 5_000;

async function main(): Promise<void> {
  const runnerId = process.env.RUNNER_ID ?? `local:${process.pid}`;
  const orchestrator = new Orchestrator({ store: new FirestoreStore(), runnerId });

  console.log(`[orchestrator] starting as "${runnerId}", ticking every ${TICK_INTERVAL_MS}ms`);

  const tick = async (): Promise<void> => {
    try {
      const summary = await orchestrator.tick();
      if (summary.started.length > 0 || summary.finished.length > 0 || summary.stepsAdvanced > 0) {
        console.log(
          `[orchestrator] tick: ${summary.activeRuns} active, ` +
            `+${summary.started.length} started, ${summary.finished.length} finished, ` +
            `${summary.stepsAdvanced} step(s) advanced`,
        );
      }
    } catch (error) {
      console.error('[orchestrator] tick failed:', error);
    }
  };

  await tick();
  setInterval(() => void tick(), TICK_INTERVAL_MS);
}

void main();
