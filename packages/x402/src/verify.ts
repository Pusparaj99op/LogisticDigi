/**
 * Payment payload verification.
 *
 * This is the gate between "a counterparty sent us bytes" and "we settled
 * funds on a public ledger". It runs before anything is submitted to the
 * chain, and it is pure: no network, no clock, no chain state beyond what is
 * passed in. That makes every rejection path exhaustively testable, which is
 * the point — a verifier you cannot test is a verifier you cannot trust.
 *
 * Replay protection is layered deliberately:
 *
 *   1. **Nonce ledger (ours).** A nonce is single-use. A second payload
 *      bearing a spent nonce is refused here, before submission.
 *   2. **Transaction lease (Algorand's).** The same nonce is bound into the
 *      transaction's 32-byte lease field. Algorand itself will reject a
 *      second transaction from the same sender carrying the same lease
 *      inside the validity window.
 *
 * Layer 1 alone would fail if our database lost a write; layer 2 alone would
 * fail once the validity window elapsed. Together, a replay must defeat both
 * a durable record and consensus.
 */

import { formatMoney, type Money } from '@logisticdigi/core';
import { isExpired, type PaymentRequirements, PERMITTED_NETWORK } from './requirements.js';

/**
 * What the client sends back on the retry.
 *
 * The transaction is carried as base64 msgpack exactly as algosdk encodes it,
 * so the bytes we verify are the bytes we submit — no re-encoding step in
 * between where a field could drift.
 */
export interface PaymentPayload {
  readonly x402Version: 1;
  readonly scheme: string;
  readonly network: string;
  /** Base64 msgpack of the signed transaction. */
  readonly signedTxn: string;
  /** Must echo the nonce from the requirements. */
  readonly nonce: string;
  /** Must echo the resource correlation id. */
  readonly resource: string;
}

/**
 * The fields we decode out of the signed transaction.
 *
 * Supplied by the Algorand adapter so this module stays chain-free. Amounts
 * are bigint minor units, matching the asset's on-chain denomination.
 */
export interface DecodedTransfer {
  readonly sender: string;
  readonly receiver: string;
  readonly assetId: number;
  readonly amount: bigint;
  /** Base64 of the 32-byte lease, or null when absent. */
  readonly lease: string | null;
  readonly firstValid: bigint;
  readonly lastValid: bigint;
  /** Whether the signature checks out against the sender's key. */
  readonly signatureValid: boolean;
  /** Present when the transaction would rekey the sender's account. */
  readonly rekeyTo: string | null;
  /** Present when the transaction closes out the sender's asset holding. */
  readonly closeRemainderTo: string | null;
}

export type VerificationCode =
  | 'VERSION_MISMATCH'
  | 'SCHEME_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'NETWORK_FORBIDDEN'
  | 'NONCE_MISMATCH'
  | 'NONCE_ALREADY_USED'
  | 'RESOURCE_MISMATCH'
  | 'REQUIREMENTS_EXPIRED'
  | 'BAD_SIGNATURE'
  | 'WRONG_RECEIVER'
  | 'WRONG_ASSET'
  | 'AMOUNT_TOO_LOW'
  | 'AMOUNT_EXCEEDS_CEILING'
  | 'LEASE_MISSING'
  | 'LEASE_MISMATCH'
  | 'VALIDITY_WINDOW_TOO_WIDE'
  | 'DANGEROUS_REKEY'
  | 'DANGEROUS_CLOSE';

export type VerificationResult =
  | { readonly ok: true; readonly amount: Money }
  | { readonly ok: false; readonly code: VerificationCode; readonly reason: string };

/** State the verifier consults. Supplied by the caller, never fetched here. */
export interface VerificationContext {
  readonly requirements: PaymentRequirements;
  readonly decoded: DecodedTransfer;
  readonly now: number;
  /** True when this nonce has already been settled. */
  readonly nonceAlreadyUsed: boolean;
  /** Current chain round, for bounding the validity window. */
  readonly currentRound: bigint;
}

/**
 * Widest transaction validity window we will accept.
 *
 * Algorand allows up to 1000 rounds (~50 minutes). We insist on far less:
 * the lease only protects against replay *within* the validity window, so a
 * wide window is a long replay opportunity if our nonce ledger were ever
 * lost. 200 rounds is roughly 10 minutes — ample for submission and
 * confirmation, tight enough that the lease is doing real work.
 */
export const MAX_VALIDITY_ROUNDS = 200n;

/**
 * Verify a payment payload against the requirements that provoked it.
 *
 * Checks run cheapest-first and in dependency order: protocol framing, then
 * identity of the request, then cryptography, then the money, then the
 * on-chain safety properties. Every branch returns a code the trace can
 * record, rather than a bare false.
 */
export function verifyPayment(
  payload: PaymentPayload,
  context: VerificationContext,
): VerificationResult {
  const { requirements, decoded } = context;

  // ---- protocol framing ----

  if (payload.x402Version !== 1) {
    return refuse('VERSION_MISMATCH', `payload declares x402Version ${payload.x402Version}`);
  }
  if (payload.scheme !== requirements.scheme) {
    return refuse(
      'SCHEME_MISMATCH',
      `payload uses scheme "${payload.scheme}" but the requirements specified "${requirements.scheme}"`,
    );
  }
  if (payload.network !== requirements.network) {
    return refuse(
      'NETWORK_MISMATCH',
      `payload is for "${payload.network}" but the requirements specified "${requirements.network}"`,
    );
  }
  if (requirements.network !== PERMITTED_NETWORK) {
    // Belt and braces: a misconfigured env var must never move real funds.
    return refuse(
      'NETWORK_FORBIDDEN',
      `this build settles only on ${PERMITTED_NETWORK}, never "${requirements.network}"`,
    );
  }

  // ---- identity of the request ----

  if (payload.nonce !== requirements.nonce) {
    return refuse('NONCE_MISMATCH', 'payload nonce does not match the issued requirements');
  }
  if (payload.resource !== requirements.resource) {
    return refuse(
      'RESOURCE_MISMATCH',
      `payload is for resource "${payload.resource}" but the requirements were issued for ` +
        `"${requirements.resource}"`,
    );
  }
  if (context.nonceAlreadyUsed) {
    // The duplicate-settlement case. Refused before submission, so we never
    // even attempt a second transfer.
    return refuse(
      'NONCE_ALREADY_USED',
      `nonce has already been settled; this is a duplicate payment attempt and is refused`,
    );
  }
  if (isExpired(requirements, context.now)) {
    return refuse(
      'REQUIREMENTS_EXPIRED',
      `the quote expired at ${requirements.expiresAt} and it is now ${context.now}; re-quote`,
    );
  }

  // ---- cryptography ----

  if (!decoded.signatureValid) {
    return refuse('BAD_SIGNATURE', 'the transaction signature does not verify against the sender');
  }

  // ---- the money ----

  if (decoded.receiver !== requirements.payTo) {
    // A redirected payment: the classic injection payoff.
    return refuse(
      'WRONG_RECEIVER',
      `the transaction pays ${decoded.receiver} but the requirements named ${requirements.payTo}`,
    );
  }
  if (decoded.assetId !== requirements.assetId) {
    return refuse(
      'WRONG_ASSET',
      `the transaction moves ASA ${decoded.assetId} but the requirements named ` +
        `ASA ${requirements.assetId}`,
    );
  }

  const required = requirements.maxAmountRequired;
  const paid: Money = { asset: required.asset, units: decoded.amount };

  if (requirements.scheme === 'exact') {
    if (decoded.amount !== required.units) {
      return refuse(
        decoded.amount < required.units ? 'AMOUNT_TOO_LOW' : 'AMOUNT_EXCEEDS_CEILING',
        `the exact scheme requires precisely ${formatMoney(required)}, but the transaction ` +
          `moves ${formatMoney(paid)}`,
      );
    }
  } else {
    if (decoded.amount <= 0n) {
      return refuse('AMOUNT_TOO_LOW', 'an upto payment must move a positive amount');
    }
    if (decoded.amount > required.units) {
      // The provider raising its price after approval, seen from the payment
      // layer rather than the budget layer.
      return refuse(
        'AMOUNT_EXCEEDS_CEILING',
        `the transaction moves ${formatMoney(paid)}, above the authorised ceiling of ` +
          `${formatMoney(required)}`,
      );
    }
  }

  // ---- on-chain safety properties ----

  if (decoded.lease === null) {
    return refuse(
      'LEASE_MISSING',
      'the transaction carries no lease, so the chain cannot reject a replay of it',
    );
  }
  if (decoded.lease !== requirements.nonce) {
    return refuse(
      'LEASE_MISMATCH',
      'the transaction lease does not equal the issued nonce, so on-chain replay protection ' +
        'would not be bound to this quote',
    );
  }

  const window = decoded.lastValid - decoded.firstValid;
  if (window > MAX_VALIDITY_ROUNDS) {
    return refuse(
      'VALIDITY_WINDOW_TOO_WIDE',
      `the transaction is valid for ${window} rounds, above the ${MAX_VALIDITY_ROUNDS} round ` +
        'limit; a wide window lengthens the replay opportunity the lease has to cover',
    );
  }

  if (decoded.rekeyTo !== null) {
    // A rekey would hand control of the paying account to someone else. It
    // has no legitimate place in a payment and is refused unconditionally.
    return refuse(
      'DANGEROUS_REKEY',
      `the transaction rekeys the sender to ${decoded.rekeyTo}; a payment must never rekey`,
    );
  }
  if (decoded.closeRemainderTo !== null) {
    // A close-out would sweep the account's entire remaining balance of the
    // asset to a third party alongside the payment.
    return refuse(
      'DANGEROUS_CLOSE',
      `the transaction closes the sender's asset holding to ${decoded.closeRemainderTo}; ` +
        'a payment must never close out',
    );
  }

  return { ok: true, amount: paid };
}

function refuse(code: VerificationCode, reason: string): VerificationResult {
  return { ok: false, code, reason };
}

/**
 * A settled payment: the evidence the fulfilment verifier and ledger cite.
 *
 * `explorerUrl` is included because a judge should be able to click through
 * to an independent view of the transaction rather than take our word.
 */
export interface Receipt {
  readonly txid: string;
  readonly confirmedRound: bigint;
  readonly network: string;
  readonly assetId: number;
  readonly from: string;
  readonly to: string;
  readonly amount: Money;
  readonly nonce: string;
  readonly resource: string;
  readonly scheme: Scheme;
  readonly settledAt: number;
  readonly explorerUrl: string;
}

type Scheme = PaymentRequirements['scheme'];

export function explorerUrlFor(txid: string, network: string): string {
  const subdomain = network === 'algorand-mainnet' ? 'allo.info/tx' : 'testnet.allo.info/tx';
  return `https://${subdomain}/${txid}`;
}
