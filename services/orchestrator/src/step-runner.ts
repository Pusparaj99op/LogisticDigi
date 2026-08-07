/**
 * One step's execution against the guarded executor, plus the one thing the
 * eval never needed: an actual human on the other end of an approval gate.
 *
 * eval/src/executor.ts's guardedExecutor treats a budget decision of
 * `requires_approval` as a pass, because the eval harness has no person to
 * ask. Here there is one — the operations console — so the `approve` step
 * kind is handled separately: a `requires_approval` decision opens a
 * Firestore approvals doc and asks tick.ts to pause the step, instead of
 * nodding it through.
 */

import {
  evaluateReservation,
  formatMoney,
  toJSON,
  type CompiledStep,
} from '@logisticdigi/core';
import { guardedExecutor, type World } from '@logisticdigi/eval';
import type { ApprovalDoc, Store } from './store.js';

export type StepOutcome =
  | { readonly kind: 'succeeded'; readonly output: Record<string, unknown> }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'await_approval' };

export interface StepRunnerParams {
  readonly step: CompiledStep;
  readonly world: World;
  readonly store: Store;
  readonly tenantId: string;
  readonly runId: string;
  readonly now: number;
}

/** Deterministic id an approval doc and its step share, so a re-check finds it. */
export function approvalDocId(runId: string, stepId: string): string {
  return `${runId}:${stepId}`;
}

async function runApproveStep(params: StepRunnerParams): Promise<StepOutcome> {
  const { step, world, store, tenantId, runId, now } = params;
  const amount = world.agreedPrice;
  if (!amount) return { kind: 'failed', error: 'nothing to approve' };

  // A human already decided this one. resolveApproval() (in tick.ts) only
  // ever sends an *approved* step back through here — a rejection routes the
  // step straight to skipped without re-entering this function — so finding
  // an approved doc means "grant it," never "ask again."
  const existing = await store.getApproval(runId, step.id);
  if (existing?.status === 'approved') {
    world.record('approval_granted', step.id, formatMoney(amount), amount);
    return { kind: 'succeeded', output: { approved: true, amount: toJSON(amount) } };
  }

  const decision = evaluateReservation(
    world.budget,
    { stepId: step.id, idempotencyKey: `${step.id}:approve`, amount },
    new Date(now),
  );

  if (decision.outcome === 'deny') {
    world.record('overspend_prevented', step.id, decision.reason, amount);
    return { kind: 'failed', error: `approval refused: ${decision.reason}` };
  }

  if (decision.outcome === 'requires_approval') {
    const offer = world.agreedOffer;
    const doc: ApprovalDoc = {
      id: approvalDocId(runId, step.id),
      tenantId,
      runId,
      stepId: step.id,
      status: 'pending',
      amountUnits: amount.units.toString(),
      asset: amount.asset,
      counterparty: offer ? (world.fleet.profile(offer.providerId)?.name ?? offer.providerId) : 'unknown counterparty',
      description: offer?.title ?? step.description,
      reason: decision.reason,
      requestedAt: now,
    };
    await store.createApproval(doc);
    world.record('approval_requested', step.id, formatMoney(amount), amount);
    return { kind: 'await_approval' };
  }

  world.record('approval_granted', step.id, formatMoney(amount), amount);
  return { kind: 'succeeded', output: { approved: true, amount: toJSON(amount) } };
}

export async function runStep(params: StepRunnerParams): Promise<StepOutcome> {
  if (params.step.kind === 'approve') {
    return runApproveStep(params);
  }

  const result = await guardedExecutor(params.step, params.world);
  if (result.status === 'succeeded') return { kind: 'succeeded', output: result.output };
  if (result.status === 'skipped') {
    const reason = typeof result.output.reason === 'string' ? result.output.reason : 'skipped';
    return { kind: 'skipped', reason };
  }
  return { kind: 'failed', error: result.error ?? `"${params.step.id}" failed with no message` };
}
