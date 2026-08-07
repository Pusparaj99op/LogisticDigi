import { describe, expect, it } from 'vitest';
import algosdk from 'algosdk';
import { parseAmount } from '@logisticdigi/core';
import {
  buildPaymentTransaction,
  createAlgodClient,
  decodeSignedTransfer,
  generateNonce,
  LEASE_BYTES,
  leaseToNonce,
  nonceToLease,
  TESTNET_DEFAULTS,
  VALIDITY_ROUNDS,
} from './algorand.js';
import {
  buildRequirements,
  type PaymentRequirements,
  ProtocolError,
  TESTNET_USDC_ASSET_ID,
} from './requirements.js';
import { MAX_VALIDITY_ROUNDS, verifyPayment } from './verify.js';

const usdc = (amount: string) => parseAmount('USDC', amount);
const T0 = 1_700_000_000_000;

/**
 * Real keypairs. These are generated fresh each run and never funded, so
 * they are not secrets — but they let the whole build-sign-decode-verify
 * path be exercised with genuine Ed25519 signatures rather than stubs.
 */
const payer = algosdk.generateAccount();
const payee = algosdk.generateAccount();
const attacker = algosdk.generateAccount();

function suggestedParams(): algosdk.SuggestedParams {
  return {
    fee: 1_000n,
    minFee: 1_000n,
    firstValid: 40_000_000n,
    lastValid: 40_001_000n,
    genesisID: 'testnet-v1.0',
    genesisHash: new Uint8Array(32),
    flatFee: true,
  } as unknown as algosdk.SuggestedParams;
}

function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    ...buildRequirements({
      scheme: 'exact',
      payTo: payee.addr.toString(),
      maxAmountRequired: usdc('300'),
      nonce: generateNonce(),
      resource: 'run_1:pay_supplier',
      description: 'Reefer container, Rotterdam to Mumbai',
      now: T0,
    }),
    ...overrides,
  };
}

/** Build, sign, and base64-encode a payment, as a real client would. */
function signPayment(
  reqs: PaymentRequirements,
  amount = reqs.maxAmountRequired,
  account = payer,
): string {
  const txn = buildPaymentTransaction({
    requirements: reqs,
    sender: account.addr.toString(),
    amount,
    suggestedParams: suggestedParams(),
  });
  return Buffer.from(txn.signTxn(account.sk)).toString('base64');
}

describe('nonce and lease', () => {
  it('generates a 32-byte nonce', () => {
    expect(Buffer.from(generateNonce(), 'base64')).toHaveLength(LEASE_BYTES);
  });

  it('generates a distinct nonce each time', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => generateNonce()));
    expect(nonces.size).toBe(200);
  });

  it('round-trips a nonce through the lease encoding', () => {
    const nonce = generateNonce();
    expect(leaseToNonce(nonceToLease(nonce))).toBe(nonce);
  });

  it('refuses a nonce that is not exactly 32 bytes', () => {
    expect(() => nonceToLease(Buffer.from('short').toString('base64'))).toThrow(ProtocolError);
  });

  it('reports an absent lease as null rather than an empty string', () => {
    expect(leaseToNonce(undefined)).toBeNull();
    expect(leaseToNonce(new Uint8Array(0))).toBeNull();
  });
});

describe('buildPaymentTransaction', () => {
  it('binds the nonce into the transaction lease', () => {
    // The core design claim: on-chain replay protection comes free from a
    // primitive the chain already enforces.
    const reqs = requirements();
    const decoded = decodeSignedTransfer(signPayment(reqs));
    expect(decoded.lease).toBe(reqs.nonce);
  });

  it('pins the validity window rather than trusting the node\'s suggestion', () => {
    // suggestedParams offers 1000 rounds; we insist on VALIDITY_ROUNDS.
    const decoded = decodeSignedTransfer(signPayment(requirements()));
    expect(decoded.lastValid - decoded.firstValid).toBe(BigInt(VALIDITY_ROUNDS));
  });

  it('keeps the window inside the verifier\'s ceiling', () => {
    expect(BigInt(VALIDITY_ROUNDS)).toBeLessThanOrEqual(MAX_VALIDITY_ROUNDS);
  });

  it('never sets rekeyTo or closeRemainderTo', () => {
    // The other half of the verifier's refusal: we neither build nor accept
    // a payment carrying either field.
    const decoded = decodeSignedTransfer(signPayment(requirements()));
    expect(decoded.rekeyTo).toBeNull();
    expect(decoded.closeRemainderTo).toBeNull();
  });

  it('refuses to underpay an exact quote', () => {
    expect(() => signPayment(requirements(), usdc('299'))).toThrow(/precisely the quoted amount/);
  });

  it('refuses to overpay any quote', () => {
    const reqs = requirements({ scheme: 'upto' });
    expect(() => signPayment(reqs, usdc('301'))).toThrow(/exceeds the authorised ceiling/);
  });

  it('refuses a zero payment', () => {
    expect(() => signPayment(requirements({ scheme: 'upto' }), usdc('0'))).toThrow(
      /positive amount/,
    );
  });

  it('refuses to build for mainnet', () => {
    expect(() => signPayment(requirements({ network: 'algorand-mainnet' }))).toThrow(
      /NETWORK_FORBIDDEN|refusing to build/,
    );
  });

  it('allows a partial payment under the upto scheme', () => {
    const reqs = requirements({ scheme: 'upto' });
    const decoded = decodeSignedTransfer(signPayment(reqs, usdc('180')));
    expect(decoded.amount).toBe(usdc('180').units);
  });
});

describe('decodeSignedTransfer', () => {
  it('extracts the parties, asset, and amount', () => {
    const reqs = requirements();
    const decoded = decodeSignedTransfer(signPayment(reqs));
    expect(decoded.sender).toBe(payer.addr.toString());
    expect(decoded.receiver).toBe(payee.addr.toString());
    expect(decoded.assetId).toBe(TESTNET_USDC_ASSET_ID);
    expect(decoded.amount).toBe(usdc('300').units);
  });

  it('verifies a genuine signature', () => {
    expect(decodeSignedTransfer(signPayment(requirements())).signatureValid).toBe(true);
  });

  it('rejects a signature from the wrong key', () => {
    // Sign the payer's transaction with the attacker's key: the signature is
    // well-formed but does not verify against the declared sender.
    const reqs = requirements();
    const txn = buildPaymentTransaction({
      requirements: reqs,
      sender: payer.addr.toString(),
      amount: reqs.maxAmountRequired,
      suggestedParams: suggestedParams(),
    });
    // signTxn with a foreign key produces an authAddr-less signature that
    // cannot verify against the sender's public key.
    const forged = Buffer.from(txn.signTxn(attacker.sk)).toString('base64');
    expect(decodeSignedTransfer(forged).signatureValid).toBe(false);
  });

  it('throws on bytes that are not a transaction', () => {
    expect(() => decodeSignedTransfer(Buffer.from('garbage').toString('base64'))).toThrow(
      ProtocolError,
    );
  });

  it('throws on a payment transaction rather than an asset transfer', () => {
    // ALGO payments are not accepted: settlement is in USDC.
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: payer.addr.toString(),
      receiver: payee.addr.toString(),
      amount: 1_000n,
      suggestedParams: suggestedParams(),
    });
    const signed = Buffer.from(txn.signTxn(payer.sk)).toString('base64');
    expect(() => decodeSignedTransfer(signed)).toThrow(/expected an asset transfer/);
  });
});

describe('end to end: a real signed transaction through the verifier', () => {
  function contextFor(reqs: PaymentRequirements, signedTxn: string, overrides = {}) {
    return {
      requirements: reqs,
      decoded: decodeSignedTransfer(signedTxn),
      now: T0 + 1_000,
      nonceAlreadyUsed: false,
      currentRound: 40_000_000n,
      ...overrides,
    };
  }

  function payloadFor(reqs: PaymentRequirements, signedTxn: string) {
    return {
      x402Version: 1 as const,
      scheme: reqs.scheme,
      network: reqs.network,
      signedTxn,
      nonce: reqs.nonce,
      resource: reqs.resource,
    };
  }

  it('accepts a genuine exact payment', () => {
    const reqs = requirements();
    const signed = signPayment(reqs);
    const result = verifyPayment(payloadFor(reqs, signed), contextFor(reqs, signed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount.units).toBe(usdc('300').units);
  });

  it('accepts a genuine partial upto payment', () => {
    const reqs = requirements({ scheme: 'upto' });
    const signed = signPayment(reqs, usdc('180'));
    const result = verifyPayment(payloadFor(reqs, signed), contextFor(reqs, signed));
    expect(result.ok).toBe(true);
  });

  it('refuses the same payment presented twice', () => {
    // The duplicate-settlement path, end to end with real bytes.
    const reqs = requirements();
    const signed = signPayment(reqs);
    const first = verifyPayment(payloadFor(reqs, signed), contextFor(reqs, signed));
    expect(first.ok).toBe(true);

    const second = verifyPayment(
      payloadFor(reqs, signed),
      contextFor(reqs, signed, { nonceAlreadyUsed: true }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('NONCE_ALREADY_USED');
  });

  it('refuses a payment built for a different quote', () => {
    // A real, correctly-signed transaction — but for another nonce. Replay
    // across quotes must fail on the lease binding, not merely on bookkeeping.
    const original = requirements();
    const other = requirements();
    const signedForOther = signPayment(other);

    const result = verifyPayment(
      payloadFor(original, signedForOther),
      contextFor(original, signedForOther),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('LEASE_MISMATCH');
  });

  it('refuses a payment redirected to an attacker', () => {
    const reqs = requirements();
    const hostile = { ...reqs, payTo: attacker.addr.toString() };
    // Client pays the attacker while presenting the honest requirements.
    const signed = signPayment(hostile);
    const result = verifyPayment(payloadFor(reqs, signed), contextFor(reqs, signed));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('WRONG_RECEIVER');
  });

  it('refuses a forged signature', () => {
    const reqs = requirements();
    const txn = buildPaymentTransaction({
      requirements: reqs,
      sender: payer.addr.toString(),
      amount: reqs.maxAmountRequired,
      suggestedParams: suggestedParams(),
    });
    const forged = Buffer.from(txn.signTxn(attacker.sk)).toString('base64');
    const result = verifyPayment(payloadFor(reqs, forged), contextFor(reqs, forged));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BAD_SIGNATURE');
  });
});

describe('createAlgodClient', () => {
  it('builds a TestNet client', () => {
    expect(createAlgodClient(TESTNET_DEFAULTS)).toBeInstanceOf(algosdk.Algodv2);
  });

  it('refuses to build a mainnet client', () => {
    // The hard stop against a misconfigured env var moving real funds.
    expect(() =>
      createAlgodClient({ ...TESTNET_DEFAULTS, network: 'algorand-mainnet' }),
    ).toThrow(/settles only on algorand-testnet/);
  });
});
