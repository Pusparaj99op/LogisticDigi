/**
 * Advances every in-flight demo run by one tick, and starts a fresh one when
 * there is spare capacity.
 *
 * State lives in process memory (see `Orchestrator` below), not
 * reconstructed from Firestore on each call — this is the "local worker"
 * mode packages/core/src/runtime/lease.ts's docstring anticipates, run as one
 * long-lived process (worker.ts) rather than a stateless serverless
 * function. A tick endpoint that rebuilds a run's World and RunState from
 * persisted documents on every cold start is a real extension, but it is not
 * this one: reconstructing a live World (provider fleet, nonce store, signed
 * keys, in-flight receipts) from Firestore documents is a project in its own
 * right, and building it half-way would be worse than not building it.
 */

import {
  awaitApproval,
  claim,
  claimableSteps,
  completeStep,
  createRun,
  disposition,
  failStep,
  finalise,
  markClaimed,
  resolveApproval,
  skipStep,
  type RunState,
} from '@logisticdigi/core';
import type { World } from '@logisticdigi/eval';
import type { CompiledWorkflow } from '@logisticdigi/core';
import { startDemoRun, type DemoRun } from './demo.js';
import { ledgerEntriesFor, negotiationDocsFrom, shipmentDocFrom, stepDocFrom, traceDocsFrom } from './mirror.js';
import { runStep } from './step-runner.js';
import type { Store } from './store.js';

export interface OrchestratorOptions {
  readonly store: Store;
  readonly runnerId: string;
  readonly maxConcurrentRuns?: number;
}

export interface TickSummary {
  readonly at: number;
  readonly activeRuns: number;
  readonly started: readonly string[];
  readonly finished: readonly string[];
  readonly stepsAdvanced: number;
}

export interface LiveRun {
  readonly tenantId: string;
  readonly workflow: CompiledWorkflow;
  readonly world: World;
  readonly run: RunState;
}

/**
 * Drive one run one step further: resume any awaiting-approval step whose
 * decision has landed, then claim and execute steps until nothing more can
 * advance without another tick or another human decision.
 *
 * A standalone function, not a class method, specifically so it can be
 * exercised in tests against a hand-built LiveRun and a MemoryStore, without
 * going through the scenario-suite randomness `Orchestrator.tick` uses to
 * pick what to run next.
 */
export async function driveRun(store: Store, runnerId: string, live: LiveRun, now: number): Promise<RunState> {
  const { workflow, world } = live;
  let run = live.run;
  const traceBefore = run.trace.length;

  for (const [stepId, record] of run.steps) {
    if (record.status !== 'awaiting_approval') continue;
    const approval = await store.getApproval(run.runId, stepId);
    if (!approval || approval.status === 'pending') continue;
    run = resolveApproval(run, {
      stepId,
      approved: approval.status === 'approved',
      decidedBy: approval.decidedBy ?? 'unknown',
      ...(approval.note ? { note: approval.note } : {}),
      at: now,
    });
  }

  let progressed = true;
  while (progressed) {
    progressed = false;
    const claimable = claimableSteps(run, workflow, now);

    for (const stepId of claimable) {
      const step = workflow.steps.get(stepId);
      const record = run.steps.get(stepId);
      if (!step || !record) continue;

      const claimResult = claim(record.lease, runnerId, now);
      if (!claimResult.ok) continue;
      run = markClaimed(run, stepId, claimResult.lease, now);
      progressed = true;
      await store.putStep(run.runId, stepDocFrom(run, stepId));

      const disp = disposition(run, step, workflow);
      if (disp.action === 'skip') {
        run = skipStep(run, stepId, disp.reason, now);
      } else if (disp.action === 'await_approval') {
        run = awaitApproval(run, stepId, now);
      } else {
        const budgetBefore = world.budget;
        const receiptsBefore = world.receipts.length;
        const outcome = await runStep({
          step,
          world,
          store,
          tenantId: live.tenantId,
          runId: run.runId,
          now,
        });

        if (outcome.kind === 'await_approval') {
          run = awaitApproval(run, stepId, now);
        } else if (outcome.kind === 'succeeded') {
          run = completeStep(run, {
            stepId,
            owner: runnerId,
            fenceToken: claimResult.lease.fenceToken,
            output: outcome.output,
            at: now,
          });

          // A negotiated deal, presented as the exchange it was — see
          // mirror.ts's negotiationDocsFrom for why this is real offer data,
          // not invented dialogue.
          if (step.kind === 'negotiate' && world.agreedOffer && world.agreedPrice) {
            const { negotiation, messages } = negotiationDocsFrom(step, world.agreedOffer, world.agreedPrice, {
              tenantId: live.tenantId,
              runId: run.runId,
              at: now,
            });
            await store.putNegotiation(negotiation);
            await store.appendMessages(negotiation.id, messages);
          }

          // A freight quote is where a shipment is booked — see
          // mirror.ts's shipmentDocFrom for why this only fires for the one
          // scenario spec that actually models freight as its own step
          // (three_provider_conditional's quote_freight), not invented for
          // every run.
          if (step.kind === 'quote' && step.role === 'logistics') {
            const offerId = typeof outcome.output.offerId === 'string' ? outcome.output.offerId : null;
            const offer = offerId ? world.offersSeen.find((entry) => entry.id === offerId) : undefined;
            if (offer) {
              const shipment = shipmentDocFrom(offer, {
                tenantId: live.tenantId,
                sellerTenantId: offer.providerId,
                runId: run.runId,
                at: now,
              });
              if (shipment) await store.putShipment(shipment);
            }
          }
        } else if (outcome.kind === 'skipped') {
          run = skipStep(run, stepId, outcome.reason, now);
        } else {
          run = failStep(run, {
            stepId,
            owner: runnerId,
            fenceToken: claimResult.lease.fenceToken,
            error: outcome.error,
            at: now,
          });
        }

        for (const entry of ledgerEntriesFor(budgetBefore, world.budget, {
          tenantId: live.tenantId,
          runId: run.runId,
          world,
          at: now,
        })) {
          await store.putLedgerEntry(entry);
        }

        // run.budget is a plain field on RunState — packages/core/src/runtime/run.ts
        // never touches it, since the actual reserve/settle/release/refund
        // calls happen on World.budget inside guardedExecutor. Keeping it in
        // sync here is what makes a `when` condition reading `budget.*` (see
        // conditionContext in run.ts) see the real position rather than the
        // empty budget the run was created with.
        run = { ...run, budget: world.budget };

        if (world.receipts.length > receiptsBefore) {
          const receipt = world.receipts[world.receipts.length - 1];
          if (receipt) {
            await store.putReceipt({
              id: `${run.runId}:${stepId}`,
              tenantId: live.tenantId,
              runId: run.runId,
              stepId,
              txid: receipt.txid,
              amountUnits: receipt.amount.units.toString(),
              asset: receipt.amount.asset,
              explorerUrl: receipt.explorerUrl,
              settledAt: receipt.settledAt,
            });
          }
        }
      }

      await store.putStep(run.runId, stepDocFrom(run, stepId));
    }

    run = finalise(run, workflow, now);
  }

  await store.appendTrace(run.runId, traceDocsFrom(run.trace.slice(traceBefore)));

  // world.budget, not run.budget: the RunState's own `budget` field is a
  // snapshot frozen at createRun() and step reducers never touch it — every
  // reserve/settle/release/refund happens on the World's copy, inside
  // guardedExecutor. run.budget existing at all is for conditions that read
  // `budget.*` in a step's `when`; it is not where spend actually lands.
  const settledUnits = [...world.budget.reservations.values()]
    .filter((reservation) => reservation.status === 'settled')
    .reduce((total, reservation) => total + reservation.settled.units, 0n);

  await store.putRun({
    id: run.runId,
    tenantId: run.tenantId,
    goal: workflow.goal,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    settledUnits: settledUnits.toString(),
  });

  return run;
}

/**
 * Holds every run this process is driving. One instance per worker process;
 * see worker.ts and server.ts for the two ways to call `tick`.
 */
export class Orchestrator {
  readonly #store: Store;
  readonly #runnerId: string;
  readonly #maxConcurrentRuns: number;
  readonly #live = new Map<string, { demo: DemoRun; run: RunState }>();
  #runIndex = 0;

  constructor(options: OrchestratorOptions) {
    this.#store = options.store;
    this.#runnerId = options.runnerId;
    this.#maxConcurrentRuns = options.maxConcurrentRuns ?? 3;
  }

  get activeRunIds(): readonly string[] {
    return [...this.#live.keys()];
  }

  async tick(now: number = Date.now()): Promise<TickSummary> {
    const started: string[] = [];
    const finished: string[] = [];
    let stepsAdvanced = 0;

    for (const [runId, entry] of this.#live) {
      const before = entry.run;
      entry.run = await driveRun(
        this.#store,
        this.#runnerId,
        { tenantId: entry.demo.tenantId, workflow: entry.demo.workflow, world: entry.demo.world, run: entry.run },
        now,
      );
      stepsAdvanced += countAdvanced(before, entry.run);
      if (entry.run.status !== 'running') {
        finished.push(runId);
        this.#live.delete(runId);
      }
    }

    while (this.#live.size < this.#maxConcurrentRuns) {
      const demo = startDemoRun(now, this.#runIndex);
      this.#runIndex += 1;
      const run = createRun({
        runId: demo.runId,
        workflow: demo.workflow,
        budget: demo.world.budget,
        at: now,
      });
      await this.#store.putRun({
        id: run.runId,
        tenantId: run.tenantId,
        goal: demo.workflow.goal,
        status: run.status,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
      });
      await this.#store.appendTrace(run.runId, traceDocsFrom(run.trace));
      this.#live.set(run.runId, { demo, run });
      started.push(run.runId);
    }

    return {
      at: now,
      activeRuns: this.#live.size,
      started,
      finished,
      stepsAdvanced,
    };
  }
}

function countAdvanced(before: RunState, after: RunState): number {
  let count = 0;
  for (const [stepId, record] of after.steps) {
    if (before.steps.get(stepId)?.status !== record.status) count += 1;
  }
  return count;
}
