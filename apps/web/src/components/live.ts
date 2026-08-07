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
