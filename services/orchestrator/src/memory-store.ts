/**
 * In-memory Store, for tests and for running the orchestrator without a
 * Firebase project configured — the demo still runs and prints its own
 * trace, it just has no dashboard watching it.
 */

import type {
  ApprovalDoc,
  LedgerDoc,
  ReceiptDoc,
  RunDoc,
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
