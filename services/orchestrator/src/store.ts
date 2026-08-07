/**
 * The mirror the orchestrator writes through.
 *
 * Document shapes here are the write side of the contract apps/web/src/components/live.ts
 * and apps/mobile/lib/live.dart read, and of firebase/firestore.rules, which
 * says these collections are server-written and client-read. Keeping the
 * shape in one interface, implemented once for Firestore and once in memory,
 * is what lets the orchestration logic in tick.ts be tested without a live
 * Firebase project.
 */

export type RunStatusDoc = 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';

export interface RunDoc {
  readonly id: string;
  readonly tenantId: string;
  readonly goal: string;
  readonly status: RunStatusDoc;
  readonly createdAt: number;
  readonly settledUnits?: string;
  readonly finishedAt?: number | null;
}

export interface StepDoc {
  readonly stepId: string;
  readonly status: string;
  readonly attempt: number;
  readonly output: unknown;
  readonly error: string | null;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly skipReason: string | null;
}

export interface TraceDoc {
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly stepId: string | null;
  readonly summary: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalDoc {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly status: ApprovalStatus;
  readonly amountUnits: string;
  readonly asset: string;
  readonly counterparty: string;
  readonly description: string;
  readonly reason: string;
  readonly requestedAt: number;
  readonly decidedBy?: string;
  readonly decidedAt?: number;
  readonly note?: string;
}

export type LedgerKind = 'reserved' | 'settled' | 'released' | 'refunded';

export interface LedgerDoc {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly kind: LedgerKind;
  readonly amountUnits: string;
  readonly asset: string;
  readonly counterparty: string;
  readonly txid?: string;
  readonly explorerUrl?: string;
  readonly recordedAt: number;
}

export interface ReceiptDoc {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly txid: string;
  readonly amountUnits: string;
  readonly asset: string;
  readonly explorerUrl: string;
  readonly settledAt: number;
}

/**
 * The write surface a tick uses. Every method is a document upsert or
 * append — nothing here reads back a run's full state, because the
 * orchestrator keeps that in process memory for its lifetime (see
 * worker.ts). `getApproval` is the one read, because a human's decision
 * genuinely lives outside this process.
 */
export interface Store {
  putRun(run: RunDoc): Promise<void>;
  putStep(runId: string, step: StepDoc): Promise<void>;
  appendTrace(runId: string, events: readonly TraceDoc[]): Promise<void>;
  createApproval(approval: ApprovalDoc): Promise<void>;
  getApproval(runId: string, stepId: string): Promise<ApprovalDoc | null>;
  putLedgerEntry(entry: LedgerDoc): Promise<void>;
  putReceipt(receipt: ReceiptDoc): Promise<void>;
}
