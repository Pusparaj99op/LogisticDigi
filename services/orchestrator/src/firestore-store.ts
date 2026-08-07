/**
 * Firestore-backed Store: the production write side of the mirror.
 *
 * Every write here lands in a collection firebase/firestore.rules marks
 * `allow write: if false` for clients — only the Admin SDK, used here, may
 * write it. Client apps only ever read.
 */

import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { adminApp } from './admin.js';
import type {
  ApprovalDoc,
  LedgerDoc,
  ReceiptDoc,
  RunDoc,
  Store,
  StepDoc,
  TraceDoc,
} from './store.js';

export class FirestoreStore implements Store {
  readonly #db: Firestore;

  constructor(db: Firestore = getFirestore(adminApp())) {
    this.#db = db;
  }

  async putRun(run: RunDoc): Promise<void> {
    await this.#db.collection('runs').doc(run.id).set(run, { merge: true });
  }

  async putStep(runId: string, step: StepDoc): Promise<void> {
    await this.#db
      .collection('runs')
      .doc(runId)
      .collection('steps')
      .doc(step.stepId)
      .set(step, { merge: true });
  }

  async appendTrace(runId: string, events: readonly TraceDoc[]): Promise<void> {
    if (events.length === 0) return;
    const batch = this.#db.batch();
    const trace = this.#db.collection('runs').doc(runId).collection('trace');
    for (const event of events) {
      batch.set(trace.doc(String(event.seq)), event);
    }
    await batch.commit();
  }

  async createApproval(approval: ApprovalDoc): Promise<void> {
    await this.#db.collection('approvals').doc(approval.id).set(approval);
  }

  async getApproval(runId: string, stepId: string): Promise<ApprovalDoc | null> {
    const snap = await this.#db.collection('approvals').doc(`${runId}:${stepId}`).get();
    return snap.exists ? (snap.data() as ApprovalDoc) : null;
  }

  async putLedgerEntry(entry: LedgerDoc): Promise<void> {
    await this.#db.collection('ledger').doc(entry.id).set(entry);
  }

  async putReceipt(receipt: ReceiptDoc): Promise<void> {
    await this.#db.collection('receipts').doc(receipt.id).set(receipt);
  }
}
