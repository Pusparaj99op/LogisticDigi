/**
 * Turns a budget-state diff and a run's trace delta into the documents
 * apps/web and apps/mobile read. Pure functions over plain data, so they are
 * unit-testable without a Store at all.
 */

import type { BudgetState, RunState, TraceEvent } from '@logisticdigi/core';
import type { World } from '@logisticdigi/eval';
import type { LedgerDoc, StepDoc, TraceDoc } from './store.js';

export function counterpartyName(world: World, counterpartyId: string | null): string {
  if (!counterpartyId) return 'unknown counterparty';
  return world.fleet.profile(counterpartyId)?.name ?? counterpartyId;
}

function ledgerId(runId: string, stepId: string, kind: LedgerDoc['kind']): string {
  return `${runId}:${stepId}:${kind}`;
}

/**
 * Diff two budget snapshots taken immediately before and after one step, and
 * produce the ledger entries that step caused.
 *
 * Diffing the whole reservation map, not just the current step's, because a
 * `compensate` step mutates the *target* pay step's reservation (a refund),
 * not its own — see packages/core/src/policy/budget.ts's `refund`.
 */
export function ledgerEntriesFor(
  before: BudgetState,
  after: BudgetState,
  input: { readonly tenantId: string; readonly runId: string; readonly world: World; readonly at: number },
): readonly LedgerDoc[] {
  const entries: LedgerDoc[] = [];

  for (const [stepId, next] of after.reservations) {
    const prior = before.reservations.get(stepId);
    const counterparty = counterpartyName(input.world, next.counterpartyId);

    if (!prior) {
      // Reserve and settle can both happen inside one step call (a `pay`
      // step reserves, then settles, before this diff ever runs) — record
      // the reservation regardless of where the reservation ended up, so a
      // step that settled in one breath still leaves the "earmarked" entry
      // in the evidence trail, not just its outcome.
      entries.push({
        id: ledgerId(input.runId, stepId, 'reserved'),
        tenantId: input.tenantId,
        runId: input.runId,
        stepId,
        kind: 'reserved',
        amountUnits: next.reserved.units.toString(),
        asset: next.reserved.asset,
        counterparty,
        recordedAt: input.at,
      });
    }

    if (!prior || prior.status !== next.status) {
      if (next.status === 'settled') {
        const receipt = input.world.receipts.find((entry) => entry.resource.endsWith(`:${stepId}`));
        entries.push({
          id: ledgerId(input.runId, stepId, 'settled'),
          tenantId: input.tenantId,
          runId: input.runId,
          stepId,
          kind: 'settled',
          amountUnits: next.settled.units.toString(),
          asset: next.settled.asset,
          counterparty,
          recordedAt: input.at,
          ...(receipt ? { txid: receipt.txid, explorerUrl: receipt.explorerUrl } : {}),
        });
      } else if (next.status === 'released') {
        entries.push({
          id: ledgerId(input.runId, stepId, 'released'),
          tenantId: input.tenantId,
          runId: input.runId,
          stepId,
          kind: 'released',
          amountUnits: next.reserved.units.toString(),
          asset: next.reserved.asset,
          counterparty,
          recordedAt: input.at,
        });
      }
      continue;
    }

    if (next.status === 'settled' && next.settled.units < prior.settled.units) {
      const recovered = prior.settled.units - next.settled.units;
      entries.push({
        id: `${ledgerId(input.runId, stepId, 'refunded')}:${input.at}`,
        tenantId: input.tenantId,
        runId: input.runId,
        stepId,
        kind: 'refunded',
        amountUnits: recovered.toString(),
        asset: next.settled.asset,
        counterparty,
        recordedAt: input.at,
      });
    }
  }

  return entries;
}

export function stepDocFrom(run: RunState, stepId: string): StepDoc {
  const record = run.steps.get(stepId);
  if (!record) throw new Error(`run ${run.runId} has no step "${stepId}"`);
  return {
    stepId: record.stepId,
    status: record.status,
    attempt: record.attempt,
    output: record.output,
    error: record.error,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    skipReason: record.skipReason,
  };
}

export function traceDocsFrom(events: readonly TraceEvent[]): readonly TraceDoc[] {
  return events.map((event) => ({
    seq: event.seq,
    at: event.at,
    type: event.type,
    stepId: event.stepId,
    summary: event.summary,
    detail: event.detail,
  }));
}
