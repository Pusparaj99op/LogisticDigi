import { describe, expect, it, vi } from 'vitest';
import algosdk from 'algosdk';
import { parseAmount } from '@logisticdigi/core';
import {
  buildPaymentTransaction,
  generateNonce,
  SettlementError,
} from './algorand.js';
import { buildRequirements, type PaymentRequirements } from './requirements.js';
import { explorerUrlFor, type PaymentPayload, type Receipt } from './verify.js';
import { Facilitator, InMemoryNonceStore, type Settler } from './facilitator.js';

const usdc = (amount: string) => parseAmount('USDC', amount);
const T0 = 1_700_000_000_000;

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
      description: 'Reefer container',
      now: T0,
    }),
    ...overrides,
  };
}

function signPayment(reqs: PaymentRequirements, amount = reqs.maxAmountRequired, account = payer) {
  const txn = buildPaymentTransaction({
    requirements: reqs,
    sender: account.addr.toString(),
    amount,
    suggestedParams: suggestedParams(),
  });
  return Buffer.from(txn.signTxn(account.sk)).toString('base64');
}

function payloadFor(reqs: PaymentRequirements, signedTxn: string): PaymentPayload {
  return {
    x402Version: 1,
    scheme: reqs.scheme,
    network: reqs.network,
    signedTxn,
    nonce: reqs.nonce,
    resource: reqs.resource,
  };
}

/** A settler that succeeds, recording how many times it was called. */
function goodSettler(): Settler & { calls: number } {
  const settler = {
    calls: 0,
    async settle(input: Parameters<Settler['settle']>[0]): Promise<Receipt> {
      settler.calls += 1;
      const txid = `TX${settler.calls}`;
      return {
        txid,
        confirmedRound: 40_000_010n,
        network: input.requirements.network,
        assetId: input.requirements.assetId,
        from: payer.addr.toString(),
        to: input.requirements.payTo,
        amount: input.amount,
        nonce: input.requirements.nonce,
        resource: input.requirements.resource,
        scheme: input.requirements.scheme,
        settledAt: input.now,
        explorerUrl: explorerUrlFor(txid, input.requirements.network),
      };
    },
  };
  return settler;
}

function facilitatorWith(settler: Settler, nonces = new InMemoryNonceStore()) {
  return { facilitator: new Facilitator({ nonces, settler }), nonces };
}

function input(reqs: PaymentRequirements, signed: string, now = T0 + 1_000) {
  return {
    payload: payloadFor(reqs, signed),
    requirements: reqs,
    now,
    currentRound: 40_000_000n,
  };
}

describe('the happy path', () => {
  it('verifies, settles, and returns a receipt', async () => {
    const reqs = requirements();
    const settler = goodSettler();
    const { facilitator } = facilitatorWith(settler);

    const result = await facilitator.handlePayment(input(reqs, signPayment(reqs)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.txid).toBe('TX1');
    expect(result.receipt.amount.units).toBe(usdc('300').units);
  });

  it('includes an explorer link so a judge can verify independently', async () => {
    const reqs = requirements();
    const { facilitator } = facilitatorWith(goodSettler());
    const result = await facilitator.handlePayment(input(reqs, signPayment(reqs)));
    if (!result.ok) throw new Error('expected success');
    expect(result.receipt.explorerUrl).toBe('https://testnet.allo.info/tx/TX1');
  });

  it('records the settled amount for an upto payment, not the ceiling', async () => {
    const reqs = requirements({ scheme: 'upto' });
    const { facilitator } = facilitatorWith(goodSettler());
    const result = await facilitator.handlePayment(
      input(reqs, signPayment(reqs, usdc('180'))),
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.receipt.amount.units).toBe(usdc('180').units);
  });
});

describe('duplicate payment', () => {
  it('settles only once when the same payload arrives twice', async () => {
    // The property this whole module exists for.
    const reqs = requirements();
    const signed = signPayment(reqs);
    const settler = goodSettler();
    const { facilitator } = facilitatorWith(settler);

    const first = await facilitator.handlePayment(input(reqs, signed));
    const second = await facilitator.handlePayment(input(reqs, signed));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(settler.calls).toBe(1);
  });

  it('returns the original receipt rather than paying again', async () => {
    const reqs = requirements();
    const signed = signPayment(reqs);
    const { facilitator } = facilitatorWith(goodSettler());

    await facilitator.handlePayment(input(reqs, signed));
    const second = await facilitator.handlePayment(input(reqs, signed));

    if (second.ok) throw new Error('expected a duplicate refusal');
    expect(second.failure.kind).toBe('duplicate');
    if (second.failure.kind !== 'duplicate') return;
    expect(second.failure.receipt?.txid).toBe('TX1');
  });

  it('settles once when two payments race on the same nonce', async () => {
    // Both the browser tick and the cron tick can drive the same step.
    const reqs = requirements();
    const signed = signPayment(reqs);
    const settler = goodSettler();
    const { facilitator } = facilitatorWith(settler);

    const results = await Promise.all([
      facilitator.handlePayment(input(reqs, signed)),
      facilitator.handlePayment(input(reqs, signed)),
      facilitator.handlePayment(input(reqs, signed)),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(settler.calls).toBe(1);
  });

  it('claims the nonce before submitting, not after', async () => {
    // If reservation happened after settlement, a concurrent request could
    // slip past and pay twice. Proven by a settler that starts a second
    // request while the first is still in flight.
    const reqs = requirements();
    const signed = signPayment(reqs);
    const nonces = new InMemoryNonceStore();
    let secondResult: Awaited<ReturnType<Facilitator['handlePayment']>> | null = null;

    const settler: Settler = {
      async settle(settleInput) {
        // Re-enter while the first settlement is mid-flight.
        secondResult = await facilitator.handlePayment(input(reqs, signed));
        const txid = 'TX1';
        return {
          txid,
          confirmedRound: 1n,
          network: settleInput.requirements.network,
          assetId: settleInput.requirements.assetId,
          from: payer.addr.toString(),
          to: settleInput.requirements.payTo,
          amount: settleInput.amount,
          nonce: settleInput.requirements.nonce,
          resource: settleInput.requirements.resource,
          scheme: settleInput.requirements.scheme,
          settledAt: settleInput.now,
          explorerUrl: explorerUrlFor(txid, settleInput.requirements.network),
        };
      },
    };
    const facilitator = new Facilitator({ nonces, settler });

    const first = await facilitator.handlePayment(input(reqs, signed));
    expect(first.ok).toBe(true);
    expect(secondResult).not.toBeNull();
    expect(secondResult!.ok).toBe(false);
  });
});

describe('verification refusals release the nonce', () => {
  it('refuses a redirected payment and reports the code', async () => {
    const reqs = requirements();
    const hostile = { ...reqs, payTo: attacker.addr.toString() };
    const settler = goodSettler();
    const { facilitator } = facilitatorWith(settler);

    const result = await facilitator.handlePayment(input(reqs, signPayment(hostile)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('rejected');
    if (result.failure.kind !== 'rejected') return;
    expect(result.failure.code).toBe('WRONG_RECEIVER');
    expect(settler.calls).toBe(0);
  });

  it('frees the nonce so a corrected payment can use the same quote', async () => {
    // A rejected payload moved nothing, so burning the quote would force an
    // unnecessary re-quote round trip.
    const reqs = requirements();
    const settler = goodSettler();
    const { facilitator } = facilitatorWith(settler);

    const bad = await facilitator.handlePayment(
      input(reqs, signPayment({ ...reqs, payTo: attacker.addr.toString() })),
    );
    expect(bad.ok).toBe(false);

    const good = await facilitator.handlePayment(input(reqs, signPayment(reqs)));
    expect(good.ok).toBe(true);
  });

  it('refuses an expired quote without settling', async () => {
    const reqs = requirements();
    const settler = goodSettler();
    const { facilitator } = facilitatorWith(settler);
    const result = await facilitator.handlePayment(
      input(reqs, signPayment(reqs), T0 + 999_999),
    );
    expect(result.ok).toBe(false);
    expect(settler.calls).toBe(0);
  });

  it('refuses undecodable bytes without settling', async () => {
    const reqs = requirements();
    const settler = goodSettler();
    const { facilitator } = facilitatorWith(settler);
    const result = await facilitator.handlePayment(
      input(reqs, Buffer.from('not a transaction').toString('base64')),
    );
    expect(result.ok).toBe(false);
    expect(settler.calls).toBe(0);
  });
});

describe('settlement failure', () => {
  it('frees the nonce after a determinate rejection', async () => {
    // The network rejected it, so nothing moved and a retry is safe.
    const reqs = requirements();
    const nonces = new InMemoryNonceStore();
    const settler: Settler = {
      settle: vi.fn().mockRejectedValue(new SettlementError('SUBMIT_REJECTED', 'overspend')),
    };
    const facilitator = new Facilitator({ nonces, settler });

    const result = await facilitator.handlePayment(input(reqs, signPayment(reqs)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('settlement_failed');

    // The same nonce may be reused, since no payment was made.
    expect(await nonces.reserve(reqs.nonce, reqs.resource)).toBe(true);
  });

  it('holds the nonce after an indeterminate outcome', async () => {
    // The transaction may still confirm. Releasing here would let a retry
    // pay a second time — the worst outcome in the whole system.
    const reqs = requirements();
    const nonces = new InMemoryNonceStore();
    const settler: Settler = {
      settle: vi
        .fn()
        .mockRejectedValue(new SettlementError('CONFIRMATION_UNKNOWN', 'timed out', true)),
    };
    const facilitator = new Facilitator({ nonces, settler });

    const result = await facilitator.handlePayment(input(reqs, signPayment(reqs)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('indeterminate');

    // Still held: a retry cannot slip through.
    expect(await nonces.reserve(reqs.nonce, reqs.resource)).toBe(false);
  });

  it('tells the caller to reconcile rather than retry', async () => {
    const reqs = requirements();
    const settler: Settler = {
      settle: vi
        .fn()
        .mockRejectedValue(new SettlementError('CONFIRMATION_UNKNOWN', 'socket hang up', true)),
    };
    const { facilitator } = facilitatorWith(settler);
    const result = await facilitator.handlePayment(input(reqs, signPayment(reqs)));
    if (result.ok) return;
    expect(result.failure.reason).toMatch(/socket hang up/);
  });
});

describe('InMemoryNonceStore', () => {
  it('reserves a nonce exactly once', async () => {
    const store = new InMemoryNonceStore();
    expect(await store.reserve('n1', 'r1')).toBe(true);
    expect(await store.reserve('n1', 'r1')).toBe(false);
  });

  it('allows reuse after release', async () => {
    const store = new InMemoryNonceStore();
    await store.reserve('n1', 'r1');
    await store.release('n1');
    expect(await store.reserve('n1', 'r1')).toBe(true);
  });

  it('refuses reuse after commit, even following a release call', async () => {
    // A settled nonce is spent forever; release must not resurrect it.
    const store = new InMemoryNonceStore();
    await store.reserve('n1', 'r1');
    await store.commit('n1', { txid: 'TX1' } as Receipt);
    await store.release('n1');
    expect(await store.reserve('n1', 'r1')).toBe(false);
  });

  it('returns a stored receipt for reconciliation', async () => {
    const store = new InMemoryNonceStore();
    await store.commit('n1', { txid: 'TX9' } as Receipt);
    expect((await store.receiptFor('n1'))?.txid).toBe('TX9');
    expect(await store.receiptFor('unknown')).toBeNull();
  });
});
