/**
 * Turns a budget-state diff and a run's trace delta into the documents
 * apps/web and apps/mobile read. Pure functions over plain data, so they are
 * unit-testable without a Store at all.
 */

import { formatMoney, type BudgetState, type CompiledStep, type RunState, type TraceEvent } from '@logisticdigi/core';
import type { Offer, ProviderKind } from '@logisticdigi/sim';
import type { World } from '@logisticdigi/eval';
import type {
  LedgerDoc,
  MessageDoc,
  NegotiationDoc,
  ShipmentDoc,
  StepDoc,
  TraceDoc,
} from './store.js';

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

/**
 * Firestore's Admin SDK has no bigint support at all — it throws on write.
 * Several step outputs carry a `Money` (`{ asset, units: bigint }`) straight
 * from the guarded executor (a `pay` step's `paid`, a `negotiate` step's
 * `agreedPrice`), so anything headed for a StepDoc or TraceDoc must have its
 * bigints stringified first, recursively, since they can be nested arbitrarily
 * deep inside a step's own output shape.
 */
function toFirestoreSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toFirestoreSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toFirestoreSafe(entry)]));
  }
  return value;
}

export function stepDocFrom(run: RunState, stepId: string, step: CompiledStep): StepDoc {
  const record = run.steps.get(stepId);
  if (!record) throw new Error(`run ${run.runId} has no step "${stepId}"`);
  return {
    stepId: record.stepId,
    status: record.status,
    role: step.role,
    kind: step.kind,
    attempt: record.attempt,
    output: toFirestoreSafe(record.output),
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
    detail: toFirestoreSafe(event.detail) as Readonly<Record<string, unknown>>,
  }));
}

/**
 * Real coordinates for the fixed route list packages/sim/src/providers.ts
 * draws from. Not exported by that module (it is a private const), so this
 * is a small, independently-sourced lookup rather than a reach into sim's
 * internals — the value is the actual city, not an invented one.
 */
const CITY_COORDS: Readonly<Record<string, readonly [number, number]>> = {
  Rotterdam: [51.92, 4.48],
  Mumbai: [19.08, 72.88],
  Shanghai: [31.23, 121.47],
  Hamburg: [53.55, 9.99],
  Santos: [-23.96, -46.33],
  Algeciras: [36.13, -5.45],
  Singapore: [1.35, 103.82],
  Felixstowe: [51.96, 1.35],
  'Jebel Ali': [25.01, 55.06],
  Antwerp: [51.22, 4.4],
};

/** Split "Rotterdam to Mumbai" out of an offer title like "chilled pallets — Rotterdam to Mumbai". */
function parseRoute(title: string): { readonly origin: string; readonly destination: string } | null {
  const routePart = title.split('—').at(-1)?.trim();
  const match = routePart ? /^(.+?) to (.+)$/.exec(routePart) : null;
  if (!match) return null;
  return { origin: match[1] as string, destination: match[2] as string };
}

const MODE_BY_PROVIDER_KIND: Readonly<Record<ProviderKind, ShipmentDoc['mode']>> = {
  carrier: 'ship',
  supplier: 'truck',
  inspector: 'truck',
};

/**
 * A shipment record for the 3D map, built from a real discovered offer
 * rather than invented — see apps/web/src/app/operations/map/page.tsx's own
 * comment on why: "an interface that invents activity is lying to the
 * operator about what its agents are doing."
 */
export function shipmentDocFrom(
  offer: Offer,
  input: { readonly tenantId: string; readonly sellerTenantId: string; readonly runId: string; readonly at: number },
): ShipmentDoc | null {
  const route = parseRoute(offer.title);
  const origin = route ? CITY_COORDS[route.origin] : undefined;
  const destination = route ? CITY_COORDS[route.destination] : undefined;
  if (!route || !origin || !destination) return null;

  return {
    id: `${input.runId}:${offer.id}`,
    tenantId: input.tenantId,
    buyerTenantId: input.tenantId,
    sellerTenantId: input.sellerTenantId,
    runId: input.runId,
    mode: MODE_BY_PROVIDER_KIND[offer.kind],
    status: 'booked',
    originName: route.origin,
    destinationName: route.destination,
    origin,
    destination,
    progress: 0,
    etaDays: offer.etaDays,
    updatedAt: input.at,
  };
}

/**
 * The negotiate step's own accepted deal, presented as the exchange it
 * actually was: the provider's opening offer, and the 6% counter the
 * negotiation agent settled at (the same fixed concession
 * eval/src/executor.ts's guardedExecutor applies — see its `negotiate` case).
 * Grounded in the real offer and price, not invented dialogue.
 */
export function negotiationDocsFrom(
  step: CompiledStep,
  offer: Offer,
  agreedPrice: { readonly asset: 'USDC' | 'ALGO'; readonly units: bigint },
  input: { readonly tenantId: string; readonly runId: string; readonly at: number },
): { readonly negotiation: NegotiationDoc; readonly messages: readonly MessageDoc[] } {
  const negotiationId = `${input.runId}:${step.id}`;
  return {
    negotiation: {
      id: negotiationId,
      buyerTenantId: input.tenantId,
      sellerTenantId: offer.providerId,
      sellerName: offer.providerName,
      runId: input.runId,
      title: offer.title,
      startedAt: input.at,
    },
    messages: [
      {
        id: `${negotiationId}:1`,
        from: offer.providerId,
        fromRole: 'counterparty',
        to: input.tenantId,
        text: `${offer.providerName} offers ${formatMoney(offer.price)} for ${offer.title}. Terms: ${offer.scheme === 'upto' ? 'up to the quoted amount, metered' : 'fixed price'}.`,
        sentAt: input.at,
        kind: 'proposal',
      },
      {
        id: `${negotiationId}:2`,
        from: input.tenantId,
        fromRole: 'negotiation',
        to: offer.providerId,
        text: `Countering at ${formatMoney(agreedPrice)}.`,
        sentAt: input.at + 1,
        kind: 'counter',
      },
      {
        id: `${negotiationId}:3`,
        from: offer.providerId,
        fromRole: 'counterparty',
        to: input.tenantId,
        text: `${offer.providerName} accepts ${formatMoney(agreedPrice)}.`,
        sentAt: input.at + 2,
        kind: 'accept',
      },
    ],
  };
}
