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

  /*
   * Bounded mode: TICKS=n runs exactly n ticks and exits.
   *
   * Two reasons this exists rather than just Ctrl-C'ing the loop. It is how
   * you seed a demo with a known amount of history, and — because the process
   * exits normally — Node actually flushes stdout, which it does not do on a
   * SIGTERM'd infinite loop whose output is redirected to a file rather than
   * a terminal. A worker whose logs vanish when you background it is not much
   * of a worker.
   */
  const bounded = Number(process.env.TICKS ?? '0');

  console.log(
    bounded > 0
      ? `[orchestrator] starting as "${runnerId}", running ${bounded} tick(s) then exiting`
      : `[orchestrator] starting as "${runnerId}", ticking every ${TICK_INTERVAL_MS}ms`,
  );

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

  if (bounded > 0) {
    for (let i = 0; i < bounded; i += 1) await tick();
    console.log(`[orchestrator] ${bounded} tick(s) done; ${orchestrator.activeRunIds.length} run(s) still open`);
    return;
  }

  await tick();
  setInterval(() => void tick(), TICK_INTERVAL_MS);
}

void main();
