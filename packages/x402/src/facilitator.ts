/**
 * The facilitator: verify, then settle, then record.
 *
 * In x402 terms a facilitator verifies payment payloads and settles them on
 * behalf of a resource server **without taking custody of funds**. That is
 * exactly what this does — the payer signs, we relay. We never hold a payer's
 * key and never receive their funds.
 *
 * The whole value of this module is the ordering and the failure handling,
 * because both determine whether a duplicate payment is possible:
 *
 *   1. reserve the nonce  — atomically, before anything is submitted
 *   2. verify the payload — pure, no side effects
 *   3. settle on-chain    — the irreversible step
 *   4. record the receipt — evidence, keyed by nonce
 *
 * Reserving *before* verifying looks backwards, but it is the point: two
 * concurrent requests bearing the same nonce must not both reach step 3, and
 * the only way to guarantee that is a compare-and-set that happens before any
 * submission. Verification is pure and cheap, so doing it after costs
 * nothing; a rejected payload releases the reservation.
 */

import type { Money } from '@logisticdigi/core';
import type { PaymentRequirements } from './requirements.js';
import {
  type PaymentPayload,
  type Receipt,
  type VerificationCode,
  verifyPayment,
} from './verify.js';
import { decodeSignedTransfer, SettlementError } from './algorand.js';

/**
 * Durable single-use record of every nonce.
 *
 * Implemented over Firestore in production and in memory for tests. The
 * contract that matters is `reserve`: it must be atomic, returning false if
 * the nonce was already taken. A non-atomic implementation reintroduces the
 * double-payment race this module exists to close.
 */
export interface NonceStore {
  /** Atomically claim a nonce. False when it was already claimed. */
  reserve(nonce: string, resource: string): Promise<boolean>;
  /** Release a reservation whose payment never reached the chain. */
  release(nonce: string): Promise<void>;
  /** Mark a nonce settled and store its receipt. */
  commit(nonce: string, receipt: Receipt): Promise<void>;
  /** Fetch a stored receipt, for reconciliation after an unknown outcome. */
  receiptFor(nonce: string): Promise<Receipt | null>;
}

/** In-memory NonceStore. Single-process only; used by tests and the eval harness. */
export class InMemoryNonceStore implements NonceStore {
  readonly #reserved = new Map<string, string>();
  readonly #receipts = new Map<string, Receipt>();

  async reserve(nonce: string, resource: string): Promise<boolean> {
    // JavaScript's single-threaded model makes check-then-set atomic here.
    // A Firestore implementation must use a transaction to get the same
    // guarantee across processes.
    if (this.#reserved.has(nonce) || this.#receipts.has(nonce)) return false;
    this.#reserved.set(nonce, resource);
    return true;
  }

  async release(nonce: string): Promise<void> {
    this.#reserved.delete(nonce);
  }

  async commit(nonce: string, receipt: Receipt): Promise<void> {
    this.#reserved.delete(nonce);
    this.#receipts.set(nonce, receipt);
  }

  async receiptFor(nonce: string): Promise<Receipt | null> {
    return this.#receipts.get(nonce) ?? null;
  }

  get settledCount(): number {
    return this.#receipts.size;
  }
}

/** Submits a verified transaction. Abstracted so tests need no network. */
export interface Settler {
  settle(input: {
    readonly signedTxnBase64: string;
    readonly requirements: PaymentRequirements;
    readonly amount: Money;
    readonly now: number;
  }): Promise<Receipt>;
}

export type FacilitatorFailure =
  | { readonly kind: 'rejected'; readonly code: VerificationCode; readonly reason: string }
  | { readonly kind: 'duplicate'; readonly reason: string; readonly receipt: Receipt | null }
  | { readonly kind: 'settlement_failed'; readonly code: string; readonly reason: string }
  | {
      /**
       * Submitted, outcome unknown. The caller must reconcile by txid before
       * retrying: the transaction may still confirm, so a blind retry risks
       * paying twice. This is deliberately a distinct kind rather than a
       * flavour of failure, because the correct response is different.
       */
      readonly kind: 'indeterminate';
      readonly reason: string;
    };

export type FacilitatorResult =
  | { readonly ok: true; readonly receipt: Receipt }
  | { readonly ok: false; readonly failure: FacilitatorFailure };

export interface FacilitatorDeps {
  readonly nonces: NonceStore;
  readonly settler: Settler;
}

export interface HandlePaymentInput {
  readonly payload: PaymentPayload;
  readonly requirements: PaymentRequirements;
  readonly now: number;
  readonly currentRound: bigint;
}

export class Facilitator {
  readonly #deps: FacilitatorDeps;

  constructor(deps: FacilitatorDeps) {
    this.#deps = deps;
  }

  async handlePayment(input: HandlePaymentInput): Promise<FacilitatorResult> {
    const { payload, requirements } = input;
    const { nonces, settler } = this.#deps;

    // ---- 1. claim the nonce before anything can be submitted ----
    const claimed = await nonces.reserve(payload.nonce, requirements.resource);
    if (!claimed) {
      const receipt = await nonces.receiptFor(payload.nonce);
      return {
        ok: false,
        failure: {
          kind: 'duplicate',
          reason: receipt
            ? `nonce was already settled as ${receipt.txid}; returning the original receipt ` +
              'rather than paying again'
            : 'nonce is already reserved by an in-flight payment',
          receipt,
        },
      };
    }

    // ---- 2. verify (pure; releases the nonce on refusal) ----
    let decoded;
    try {
      decoded = decodeSignedTransfer(payload.signedTxn);
    } catch (error) {
      await nonces.release(payload.nonce);
      return {
        ok: false,
        failure: {
          kind: 'rejected',
          code: 'BAD_SIGNATURE',
          reason: (error as Error).message,
        },
      };
    }

    const verification = verifyPayment(payload, {
      requirements,
      decoded,
      now: input.now,
      // Already handled by the reservation above; passing false avoids
      // double-reporting the same condition under two different codes.
      nonceAlreadyUsed: false,
      currentRound: input.currentRound,
    });

    if (!verification.ok) {
      await nonces.release(payload.nonce);
      return {
        ok: false,
        failure: { kind: 'rejected', code: verification.code, reason: verification.reason },
      };
    }

    // ---- 3. settle (irreversible) ----
    let receipt: Receipt;
    try {
      receipt = await settler.settle({
        signedTxnBase64: payload.signedTxn,
        requirements,
        amount: verification.amount,
        now: input.now,
      });
    } catch (error) {
      if (error instanceof SettlementError && error.indeterminate) {
        // Deliberately do NOT release the nonce. The transaction may still
        // confirm, and releasing would let a retry submit a second payment.
        // The nonce stays held until a human or a reconciliation job
        // resolves it by txid.
        return {
          ok: false,
          failure: { kind: 'indeterminate', reason: error.message },
        };
      }
      // A determinate rejection moved nothing, so the nonce is safe to free
      // and the step can retry with a fresh quote.
      await nonces.release(payload.nonce);
      return {
        ok: false,
        failure: {
          kind: 'settlement_failed',
          code: error instanceof SettlementError ? error.code : 'UNKNOWN',
          reason: (error as Error).message,
        },
      };
    }

    // ---- 4. record ----
    await nonces.commit(payload.nonce, receipt);
    return { ok: true, receipt };
  }
}
