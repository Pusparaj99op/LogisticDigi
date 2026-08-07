'use client';

/**
 * Live Firestore subscriptions.
 *
 * Every collection here is server-written and client-read: the security rules
 * forbid a tenant writing its own runs, traces, receipts, or ledger. These
 * hooks therefore only ever read.
 *
 * Each returns a `ready` flag distinct from an empty result, so a screen can
 * tell "still connecting" from "nothing has happened yet" — the two need
 * different words in the interface.
 */

import {
  collection,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { firebaseConfigured, firestore } from '@/lib/firebase';

export interface LiveResult<T> {
  readonly items: readonly T[];
  readonly ready: boolean;
  readonly error: string | null;
}

function useCollection<T>(
  path: string | null,
  constraints: readonly QueryConstraint[],
  key: string,
): LiveResult<T> {
  const [state, setState] = useState<LiveResult<T>>({ items: [], ready: false, error: null });

  useEffect(() => {
    if (!firebaseConfigured || !path) {
      setState({ items: [], ready: true, error: null });
      return;
    }
    const unsubscribe = onSnapshot(
      query(collection(firestore(), path), ...constraints),
      (snapshot) => {
        setState({
          items: snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as T),
          ready: true,
          error: null,
        });
      },
      (error) => {
        setState({ items: [], ready: true, error: error.message });
      },
    );
    return unsubscribe;
    // `key` captures the constraint shape; constraint objects are new on every
    // render and would otherwise resubscribe in a loop.
  }, [path, key]);

  return state;
}

export interface RunSummary {
  readonly id: string;
  readonly tenantId: string;
  readonly goal: string;
  readonly status: string;
  readonly createdAt: number;
  readonly settledUnits?: string;
}

export function useRuns(tenantId: string | null, max = 20): LiveResult<RunSummary> {
  return useCollection<RunSummary>(
    tenantId ? 'runs' : null,
    [where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'), limitTo(max)],
    `runs:${tenantId}:${max}`,
  );
}

/**
 * One step of a run, as the orchestrator recorded it.
 *
 * `output` is whatever the agent produced, already bigint-stringified by the
 * orchestrator's mirror (Firestore cannot store bigint), so amounts arrive as
 * decimal strings rather than numbers.
 */
export interface RunStep {
  readonly id: string;
  readonly stepId: string;
  readonly status: string;
  /** Which specialist agent owns this step, and what the step does. */
  readonly role: string;
  readonly kind: string;
  readonly attempt: number;
  readonly output: unknown;
  readonly error: string | null;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly skipReason: string | null;
}

export function useRunSteps(runId: string | null): LiveResult<RunStep> {
  return useCollection<RunStep>(
    runId ? `runs/${runId}/steps` : null,
    [],
    `steps:${runId}`,
  );
}

/**
 * The immutable audit trail.
 *
 * `seq` is a per-run counter rather than a timestamp, so two events in the
 * same millisecond still have a defined order — see the TraceEvent docstring
 * in packages/core/src/runtime/run.ts. Ordering by it is what makes a replay
 * mean anything.
 */
export interface TraceEvent {
  readonly id: string;
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly stepId: string | null;
  readonly summary: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export function useRunTrace(runId: string | null, max = 300): LiveResult<TraceEvent> {
  return useCollection<TraceEvent>(
    runId ? `runs/${runId}/trace` : null,
    [orderBy('seq', 'asc'), limitTo(max)],
    `trace:${runId}:${max}`,
  );
}

export interface AgentMessage {
  readonly id: string;
  readonly from: string;
  readonly fromRole: string;
  readonly to: string;
  readonly text: string;
  readonly sentAt: number;
  readonly kind?: 'proposal' | 'counter' | 'accept' | 'reject' | 'note';
  readonly blocked?: boolean;
}

export function useNegotiationMessages(
  negotiationId: string | null,
  max = 100,
): LiveResult<AgentMessage> {
  return useCollection<AgentMessage>(
    negotiationId ? `negotiations/${negotiationId}/messages` : null,
    [orderBy('sentAt', 'asc'), limitTo(max)],
    `messages:${negotiationId}:${max}`,
  );
}

export interface Negotiation {
  readonly id: string;
  readonly buyerTenantId: string;
  readonly sellerTenantId: string;
  readonly sellerName: string;
  readonly runId: string;
  readonly title: string;
  readonly startedAt: number;
}

/**
 * Negotiations this tenant is the buyer in. `firebase/firestore.rules`
 * grants a party read access as either buyer or seller, but every
 * counterparty in this system is a simulated provider rather than another
 * signed-in tenant, so the tenant a console renders for is always the buyer
 * — a `sellerTenantId` filter would never match a real session.
 */
export function useNegotiations(tenantId: string | null, max = 20): LiveResult<Negotiation> {
  return useCollection<Negotiation>(
    tenantId ? 'negotiations' : null,
    [where('buyerTenantId', '==', tenantId), orderBy('startedAt', 'desc'), limitTo(max)],
    `negotiations:${tenantId}:${max}`,
  );
}

export interface ApprovalRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly amountUnits: string;
  readonly asset: string;
  readonly counterparty: string;
  readonly description: string;
  readonly reason: string;
  readonly requestedAt: number;
}

export function usePendingApprovals(tenantId: string | null): LiveResult<ApprovalRequest> {
  return useCollection<ApprovalRequest>(
    tenantId ? 'approvals' : null,
    [
      where('tenantId', '==', tenantId),
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc'),
    ],
    `approvals:${tenantId}`,
  );
}

export interface LedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly kind: 'reserved' | 'settled' | 'released' | 'refunded';
  readonly amountUnits: string;
  readonly asset: string;
  readonly counterparty: string;
  readonly txid?: string;
  readonly explorerUrl?: string;
  readonly recordedAt: number;
}

export function useLedger(tenantId: string | null, max = 100): LiveResult<LedgerEntry> {
  return useCollection<LedgerEntry>(
    tenantId ? 'ledger' : null,
    [where('tenantId', '==', tenantId), orderBy('recordedAt', 'desc'), limitTo(max)],
    `ledger:${tenantId}:${max}`,
  );
}

export interface Shipment {
  readonly id: string;
  readonly mode: 'truck' | 'ship' | 'plane';
  readonly status: string;
  readonly originName: string;
  readonly destinationName: string;
  readonly origin: readonly [number, number];
  readonly destination: readonly [number, number];
  readonly progress: number;
  readonly etaDays: number;
  readonly updatedAt: number;
}

export function useShipments(max = 50): LiveResult<Shipment> {
  return useCollection<Shipment>(
    'shipments',
    [orderBy('updatedAt', 'desc'), limitTo(max)],
    `shipments:${max}`,
  );
}
