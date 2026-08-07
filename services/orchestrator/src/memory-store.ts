/**
 * In-memory Store, for tests and for running the orchestrator without a
 * Firebase project configured — the demo still runs and prints its own
 * trace, it just has no dashboard watching it.
 */

import type {
  ApprovalDoc,
  LedgerDoc,
  MessageDoc,
  NegotiationDoc,
  ReceiptDoc,
  RunDoc,
  ShipmentDoc,
  Store,
  StepDoc,
  TraceDoc,
} from './store.js';

export class MemoryStore implements Store {
  readonly runs = new Map<string, RunDoc>();
  readonly steps = new Map<string, Map<string, StepDoc>>();
  readonly trace = new Map<string, TraceDoc[]>();
  readonly approvals = new Map<string, ApprovalDoc>();
  readonly ledger: LedgerDoc[] = [];
  readonly receipts: ReceiptDoc[] = [];
  readonly negotiations = new Map<string, NegotiationDoc>();
  readonly messages = new Map<string, MessageDoc[]>();
  readonly shipments = new Map<string, ShipmentDoc>();

  async putRun(run: RunDoc): Promise<void> {
    this.runs.set(run.id, run);
  }

  async putStep(runId: string, step: StepDoc): Promise<void> {
    const forRun = this.steps.get(runId) ?? new Map<string, StepDoc>();
    forRun.set(step.stepId, step);
    this.steps.set(runId, forRun);
  }

  async appendTrace(runId: string, events: readonly TraceDoc[]): Promise<void> {
    const existing = this.trace.get(runId) ?? [];
    this.trace.set(runId, [...existing, ...events]);
  }

  async createApproval(approval: ApprovalDoc): Promise<void> {
    this.approvals.set(approval.id, approval);
  }

  async getApproval(runId: string, stepId: string): Promise<ApprovalDoc | null> {
    return this.approvals.get(`${runId}:${stepId}`) ?? null;
  }

  async putLedgerEntry(entry: LedgerDoc): Promise<void> {
    this.ledger.push(entry);
  }

  async putReceipt(receipt: ReceiptDoc): Promise<void> {
    this.receipts.push(receipt);
  }

  async putNegotiation(negotiation: NegotiationDoc): Promise<void> {
    this.negotiations.set(negotiation.id, negotiation);
  }

  async appendMessages(negotiationId: string, messages: readonly MessageDoc[]): Promise<void> {
    const existing = this.messages.get(negotiationId) ?? [];
    this.messages.set(negotiationId, [...existing, ...messages]);
  }

  async putShipment(shipment: ShipmentDoc): Promise<void> {
    this.shipments.set(shipment.id, shipment);
  }

  /** Test helper: apply a human decision the way the console would. */
  decide(runId: string, stepId: string, approved: boolean, decidedBy = 'test-operator'): void {
    const id = `${runId}:${stepId}`;
    const existing = this.approvals.get(id);
    if (!existing) throw new Error(`no approval pending for ${id}`);
    this.approvals.set(id, {
      ...existing,
      status: approved ? 'approved' : 'rejected',
      decidedBy,
      decidedAt: Date.now(),
    });
  }
}
