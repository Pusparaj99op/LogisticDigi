/**
 * Algorand settlement adapter.
 *
 * Everything chain-specific lives here so that `verify.ts` stays pure. The
 * two jobs are building a payment transaction that carries our replay
 * protection, and decoding a counterparty's signed transaction into the
 * neutral shape the verifier checks.
 *
 * The design choice worth naming: the x402 nonce **is** the Algorand lease.
 *
 * A lease is a 32-byte value attached to a transaction. The protocol
 * guarantees that at most one transaction with a given (sender, lease) pair
 * can be confirmed within its validity window. Our nonce is already 32
 * single-use bytes, so binding it to the lease field gets on-chain replay
 * protection with no extra state, enforced by consensus rather than by our
 * database. Using a chain's native primitive instead of reimplementing it in
 * application code is the whole point of settling on Algorand.
 */

import algosdk from 'algosdk';
import { createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';
import type { Money } from '@logisticdigi/core';
import {
  type PaymentRequirements,
  PERMITTED_NETWORK,
  ProtocolError,
  TESTNET_USDC_ASSET_ID,
} from './requirements.js';
import { type DecodedTransfer, explorerUrlFor, type Receipt } from './verify.js';

/** Leases are exactly 32 bytes. Anything else is rejected by the network. */
export const LEASE_BYTES = 32;

/**
 * How many rounds a payment stays valid.
 *
 * Kept well inside the verifier's `MAX_VALIDITY_ROUNDS` ceiling. Algorand
 * produces a block roughly every 2.8s, so 100 rounds is about five minutes —
 * generous for submission and confirmation, short enough that the lease's
 * replay guarantee covers a meaningfully small window.
 */
export const VALIDITY_ROUNDS = 100;

/** Cryptographically random 32-byte nonce, base64 encoded. */
export function generateNonce(): string {
  return randomBytes(LEASE_BYTES).toString('base64');
}

export function nonceToLease(nonce: string): Uint8Array {
  const bytes = Buffer.from(nonce, 'base64');
  if (bytes.length !== LEASE_BYTES) {
    throw new ProtocolError(
      'INVALID_NONCE',
      `a lease must be exactly ${LEASE_BYTES} bytes, but this nonce decodes to ${bytes.length}`,
    );
  }
  return new Uint8Array(bytes);
}

export function leaseToNonce(lease: Uint8Array | undefined): string | null {
  if (!lease || lease.length === 0) return null;
  return Buffer.from(lease).toString('base64');
}

export interface AlgodConfig {
  readonly server: string;
  readonly port: number | string;
  readonly token: string;
  readonly network: string;
}

export function createAlgodClient(config: AlgodConfig): algosdk.Algodv2 {
  if (config.network !== PERMITTED_NETWORK) {
    // The single hard stop against a misconfiguration moving real funds.
    throw new ProtocolError(
      'NETWORK_FORBIDDEN',
      `refusing to build a client for "${config.network}"; this build settles only on ` +
        PERMITTED_NETWORK,
    );
  }
  return new algosdk.Algodv2(config.token, config.server, config.port);
}

export interface BuildPaymentInput {
  readonly requirements: PaymentRequirements;
  readonly sender: string;
  /** What to actually pay. For `exact` this must equal the required amount. */
  readonly amount: Money;
  readonly suggestedParams: algosdk.SuggestedParams;
}

/**
 * Build the asset-transfer transaction that satisfies a set of requirements.
 *
 * Deliberately omits `closeRemainderTo` and `rekeyTo` — the verifier refuses
 * transactions carrying either, and this is the other half of that pair: we
 * never construct one, and we never accept one.
 */
export function buildPaymentTransaction(input: BuildPaymentInput): algosdk.Transaction {
  const { requirements, amount } = input;

  if (requirements.network !== PERMITTED_NETWORK) {
    throw new ProtocolError(
      'NETWORK_FORBIDDEN',
      `refusing to build a payment for "${requirements.network}"`,
    );
  }
  if (amount.units <= 0n) {
    throw new ProtocolError('INVALID_AMOUNT', 'a payment must move a positive amount');
  }
  if (requirements.scheme === 'exact' && amount.units !== requirements.maxAmountRequired.units) {
    throw new ProtocolError(
      'INVALID_AMOUNT',
      'the exact scheme requires paying precisely the quoted amount',
    );
  }
  if (amount.units > requirements.maxAmountRequired.units) {
    throw new ProtocolError(
      'INVALID_AMOUNT',
      'the payment exceeds the authorised ceiling; re-quote rather than overpay',
    );
  }

  const params: algosdk.SuggestedParams = {
    ...input.suggestedParams,
    // Pin the window rather than trusting whatever the node suggested: a
    // wide window is a long replay opportunity.
    lastValid: BigInt(input.suggestedParams.firstValid) + BigInt(VALIDITY_ROUNDS),
  };

  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: input.sender,
    receiver: requirements.payTo,
    amount: amount.units,
    assetIndex: requirements.assetId,
    suggestedParams: params,
    // The nonce, doing double duty as on-chain replay protection.
    lease: nonceToLease(requirements.nonce),
  });
}

/** DER prefix for an Ed25519 public key in SubjectPublicKeyInfo form. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify an Ed25519 signature over the transaction's canonical bytes.
 *
 * Done explicitly rather than deferring to the node: submitting an invalid
 * signature and reading the error would mean a network round trip inside the
 * verification path, and would make "was this signed correctly?" untestable
 * offline. Node's crypto verifies Ed25519 natively; the only fiddly part is
 * wrapping the raw 32-byte public key in the DER envelope it expects.
 */
function verifyEd25519(message: Uint8Array, signature: Uint8Array, address: string): boolean {
  try {
    const publicKey = algosdk.decodeAddress(address).publicKey;
    const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return cryptoVerify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    // A malformed address or key is a failed verification, not a crash.
    return false;
  }
}

/**
 * Decode a base64 signed transaction into the verifier's neutral shape.
 *
 * Throws only when the bytes are not a decodable signed asset transfer.
 * Everything else — wrong receiver, wrong asset, missing lease, a rekey — is
 * reported as data for `verifyPayment` to refuse with a specific code.
 */
export function decodeSignedTransfer(signedTxnBase64: string): DecodedTransfer {
  let decoded: algosdk.SignedTransaction;
  try {
    decoded = algosdk.decodeSignedTransaction(
      new Uint8Array(Buffer.from(signedTxnBase64, 'base64')),
    );
  } catch (error) {
    throw new ProtocolError(
      'MALFORMED_TRANSACTION',
      `payload does not decode as a signed transaction: ${(error as Error).message}`,
    );
  }

  const txn = decoded.txn;
  const transfer = txn.assetTransfer;
  if (!transfer) {
    throw new ProtocolError(
      'MALFORMED_TRANSACTION',
      `expected an asset transfer, received a "${txn.type}" transaction`,
    );
  }

  const signature = decoded.sig;
  const signatureValid =
    signature !== undefined &&
    verifyEd25519(txn.bytesToSign(), signature, txn.sender.toString());

  return {
    sender: txn.sender.toString(),
    receiver: transfer.receiver.toString(),
    assetId: Number(transfer.assetIndex),
    amount: BigInt(transfer.amount),
    lease: leaseToNonce(txn.lease),
    firstValid: BigInt(txn.firstValid),
    lastValid: BigInt(txn.lastValid),
    signatureValid,
    rekeyTo: txn.rekeyTo ? txn.rekeyTo.toString() : null,
    closeRemainderTo: transfer.closeRemainderTo ? transfer.closeRemainderTo.toString() : null,
  };
}

export interface SettleInput {
  readonly client: algosdk.Algodv2;
  readonly signedTxnBase64: string;
  readonly requirements: PaymentRequirements;
  readonly amount: Money;
  readonly now: number;
  /** Rounds to wait for confirmation before giving up. */
  readonly waitRounds?: number;
}

export class SettlementError extends Error {
  readonly code: string;
  /** Set when the transaction may still confirm despite the error. */
  readonly indeterminate: boolean;

  constructor(code: string, message: string, indeterminate = false) {
    super(message);
    this.name = 'SettlementError';
    this.code = code;
    this.indeterminate = indeterminate;
  }
}

/**
 * Submit a verified payment and wait for confirmation.
 *
 * Call only after `verifyPayment` has passed. Two failure modes are
 * distinguished, and the distinction matters a great deal:
 *
 *   - **Determinate**: the network rejected the transaction. Nothing moved,
 *     and the step can safely retry with a fresh quote.
 *   - **Indeterminate**: we submitted but did not learn the outcome — a
 *     timeout, a dropped connection. The transaction may yet confirm, so
 *     retrying blindly risks a double payment. The caller must reconcile by
 *     txid before doing anything else. `indeterminate` on the error is what
 *     tells it which case it is in.
 */
export async function settlePayment(input: SettleInput): Promise<Receipt> {
  const bytes = new Uint8Array(Buffer.from(input.signedTxnBase64, 'base64'));
  const decoded = decodeSignedTransfer(input.signedTxnBase64);

  let txid: string;
  try {
    const response = await input.client.sendRawTransaction(bytes).do();
    txid = response.txid;
  } catch (error) {
    const message = (error as Error).message;
    // Algorand rejects a duplicate lease outright. Surfacing it as its own
    // code lets the orchestrator record "the chain caught the replay we
    // would also have caught" rather than a generic failure.
    if (/lease/i.test(message) && /overlap|already|duplicate/i.test(message)) {
      throw new SettlementError(
        'LEASE_ALREADY_USED',
        `the network rejected this payment because its lease is already in use: ${message}`,
      );
    }
    throw new SettlementError('SUBMIT_REJECTED', `the network rejected the payment: ${message}`);
  }

  try {
    const confirmed = await algosdk.waitForConfirmation(
      input.client,
      txid,
      input.waitRounds ?? 8,
    );
    return {
      txid,
      confirmedRound: BigInt(confirmed.confirmedRound ?? 0n),
      network: input.requirements.network,
      assetId: input.requirements.assetId,
      from: decoded.sender,
      to: decoded.receiver,
      amount: input.amount,
      nonce: input.requirements.nonce,
      resource: input.requirements.resource,
      scheme: input.requirements.scheme,
      settledAt: input.now,
      explorerUrl: explorerUrlFor(txid, input.requirements.network),
    };
  } catch (error) {
    throw new SettlementError(
      'CONFIRMATION_UNKNOWN',
      `payment ${txid} was submitted but confirmation could not be established: ` +
        `${(error as Error).message}. Reconcile by txid before retrying — the transaction ` +
        'may still confirm, and a blind retry would risk paying twice.',
      true,
    );
  }
}

/** Default TestNet configuration, using Nodely's free public endpoint. */
export const TESTNET_DEFAULTS: AlgodConfig = {
  server: 'https://testnet-api.4160.nodely.dev',
  port: 443,
  token: '',
  network: PERMITTED_NETWORK,
};

export { TESTNET_USDC_ASSET_ID };
