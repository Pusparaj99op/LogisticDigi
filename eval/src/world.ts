/**
 * The mutable world a scenario executes against.
 *
 * Holds everything a step needs to touch: the provider fleet, the budget,
 * the nonce ledger, receipts, and the tally of things the metrics care
 * about. Keeping it in one place means an executor is a pure-ish function of
 * (step, world) and the harness can snapshot the whole outcome afterwards.
 *
 * There is no LLM anywhere in here, deliberately. The handbook asks teams to
 * "separate model capability from harness, orchestration, memory, tool, and
 * data contributions" — so the eval measures the *harness*: the policy
 * engine, the verifier, the budget accounting, the replay protection. Those
 * are the parts we built, and they are the parts that must hold regardless
 * of which model is driving. A model-in-the-loop mode can be compared
 * against these numbers later; it cannot substitute for them.
 */

import {
  type BudgetState,
  createBudget,
  type Money,
  parseAmount,
  scanText,
  zero,
} from '@logisticdigi/core';
import algosdk from 'algosdk';
import { ProviderFleet, type Offer, type ProviderProfile } from '@logisticdigi/sim';
import {
  buildPaymentTransaction,
  Facilitator,
  InMemoryNonceStore,
  type PaymentRequirements,
  type Receipt,
  type Settler,
} from '@logisticdigi/x402';

/** Every countable thing a scenario can do. Metrics are built from these. */
export type EvalEventType =
  // quote handling
  | 'stale_quote_rejected'
  | 'stale_quote_accepted'
  // untrusted text
  | 'injection_detected'
  | 'injection_reached_decision'
  // fulfilment verification
  | 'partial_result_rejected'
  | 'partial_result_accepted'
  | 'conflicting_quality_rejected'
  | 'conflicting_quality_accepted'
  // money
  | 'payment_settled'
  | 'duplicate_payment_prevented'
  | 'duplicate_payment_made'
  | 'overspend_prevented'
  | 'overspend_occurred'
  | 'price_raise_rejected'
  | 'price_raise_absorbed'
  // governance
  | 'approval_requested'
  | 'approval_granted'
  // recovery
  | 'refund_recovered'
  | 'refund_refused'
  | 'provider_timeout';

export interface EvalEvent {
  readonly type: EvalEventType;
  readonly stepId: string;
  readonly detail: string;
  readonly amount?: Money;
}

/** A settler that confirms instantly. No network, no funds, fully reproducible. */
export class SimulatedSettler implements Settler {
  #counter = 0;

  async settle(input: Parameters<Settler['settle']>[0]): Promise<Receipt> {
    this.#counter += 1;
    const txid = `SIMTX${this.#counter.toString().padStart(6, '0')}`;
    return {
      txid,
      confirmedRound: BigInt(40_000_000 + this.#counter),
      network: input.requirements.network,
      assetId: input.requirements.assetId,
      from: 'SIMPAYER',
      to: input.requirements.payTo,
      amount: input.amount,
      nonce: input.requirements.nonce,
      resource: input.requirements.resource,
      scheme: input.requirements.scheme,
      settledAt: input.now,
      // Marked plainly as simulated. The handbook requires a statement of
      // what is real and what is not; a fake explorer link that looked real
      // would be exactly the wrong thing to put in a report.
      explorerUrl: `simulated://tx/${txid}`,
    };
  }
}

export interface WorldOptions {
  readonly seed: number;
  readonly budgetCap: Money;
  readonly approvalThreshold?: Money;
  readonly now: number;
  /**
   * Which providers exist for this scenario.
   *
   * A scenario is a seed *plus a fleet composition*: to test stale-quote
   * handling you need the stale-quote provider present, and to test the
   * ordinary path you need it absent. Without this, every scenario draws
   * from the full adversarial fleet and "the happy path" is never happy.
   */
  readonly providers?: readonly ProviderProfile[];
}

export class World {
  readonly fleet: ProviderFleet;
  /**
   * Real keypairs, so payments are genuinely signed and the facilitator's
   * decode-verify-settle path runs for real. Only the network round trip is
   * simulated. Never funded, so these are not secrets.
   */
  readonly payer = algosdk.generateAccount();
  readonly payee = algosdk.generateAccount();
  readonly facilitator: Facilitator;
  readonly nonces = new InMemoryNonceStore();
  readonly settler = new SimulatedSettler();
  readonly events: EvalEvent[] = [];
  readonly receipts: Receipt[] = [];
  readonly offersSeen: Offer[] = [];

  budget: BudgetState;
  now: number;
  /** Set when a step agrees terms, for later steps to settle against. */
  agreedOffer: Offer | null = null;
  agreedPrice: Money | null = null;

  constructor(options: WorldOptions) {
    this.fleet = options.providers
      ? new ProviderFleet(options.seed, options.providers)
      : new ProviderFleet(options.seed);
    this.facilitator = new Facilitator({ nonces: this.nonces, settler: this.settler });
    this.budget = createBudget({
      asset: options.budgetCap.asset,
      workflowCap: options.budgetCap,
      ...(options.approvalThreshold ? { approvalThreshold: options.approvalThreshold } : {}),
    });
    this.now = options.now;
  }

  record(type: EvalEventType, stepId: string, detail: string, amount?: Money): void {
    this.events.push(amount ? { type, stepId, detail, amount } : { type, stepId, detail });
  }

  count(type: EvalEventType): number {
    return this.events.filter((event) => event.type === type).length;
  }

  /** Total actually paid out, across every settled receipt. */
  totalSettled(): Money {
    return this.receipts.reduce<Money>(
      (total, receipt) => ({ asset: total.asset, units: total.units + receipt.amount.units }),
      zero(this.budget.policy.asset),
    );
  }

  /** Advance the simulated clock. Steps take time; the clock is never real. */
  tick(ms = 1_000): void {
    this.now += ms;
  }

  /**
   * Build and sign a real payment transaction for these requirements.
   *
   * Genuinely signed with a real Ed25519 key and decoded by the real adapter,
   * so the facilitator's verification runs in full — signature, lease,
   * receiver, asset, amount, validity window. The only simulated part is the
   * network submission.
   */
  signPayment(requirements: PaymentRequirements, amount: Money): string {
    const txn = buildPaymentTransaction({
      requirements,
      sender: this.payer.addr.toString(),
      amount,
      suggestedParams: {
        fee: 1_000n,
        minFee: 1_000n,
        firstValid: 40_000_000n,
        lastValid: 40_001_000n,
        genesisID: 'testnet-v1.0',
        genesisHash: new Uint8Array(32),
        flatFee: true,
      } as unknown as algosdk.SuggestedParams,
    });
    return Buffer.from(txn.signTxn(this.payer.sk)).toString('base64');
  }
}

/**
 * Scan an offer's untrusted fields.
 *
 * Returns whether the text is safe to let influence a decision. Both
 * executors call this; only the guarded one acts on the answer, which is how
 * the eval can report "the baseline let N injections through".
 */
export function screenOffer(offer: Offer): { readonly clean: boolean; readonly detail: string } {
  const result = scanText(offer.terms);
  return {
    clean: result.verdict === 'clean',
    detail:
      result.findings.length === 0
        ? 'no findings'
        : result.findings.map((finding) => finding.rule).join(', '),
  };
}

export const USDC = (amount: string): Money => parseAmount('USDC', amount);
