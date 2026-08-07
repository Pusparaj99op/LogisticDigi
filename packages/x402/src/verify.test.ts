import { describe, expect, it } from 'vitest';
import { parseAmount } from '@logisticdigi/core';
import {
  buildRequirements,
  DEFAULT_REQUIREMENTS_TTL_MS,
  isExpired,
  isPlausibleAddress,
  isValidNonce,
  parsePaymentRequiredBody,
  type PaymentRequirements,
  ProtocolError,
  selectRequirement,
  TESTNET_USDC_ASSET_ID,
  toPaymentRequiredBody,
} from './requirements.js';
import {
  type DecodedTransfer,
  explorerUrlFor,
  MAX_VALIDITY_ROUNDS,
  type PaymentPayload,
  verifyPayment,
  type VerificationContext,
} from './verify.js';

const usdc = (amount: string) => parseAmount('USDC', amount);
const T0 = 1_700_000_000_000;

/**
 * Shape-valid Algorand addresses: exactly 58 characters from the base32
 * alphabet (A-Z, 2-7). Prefixed so a failure message says which party is
 * which rather than showing 58 identical letters.
 */
const PAYER = `PAYER${'A'.repeat(53)}`;
const PAYEE = `PAYEE${'B'.repeat(53)}`;
const ATTACKER = `ATTACKER${'C'.repeat(50)}`;
const NONCE = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const OTHER_NONCE = 'Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA=';

function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    ...buildRequirements({
      scheme: 'exact',
      payTo: PAYEE,
      maxAmountRequired: usdc('300'),
      nonce: NONCE,
      resource: 'run_1:pay_supplier',
      description: 'Reefer container, Rotterdam to Mumbai',
      now: T0,
    }),
    ...overrides,
  };
}

function decoded(overrides: Partial<DecodedTransfer> = {}): DecodedTransfer {
  return {
    sender: PAYER,
    receiver: PAYEE,
    assetId: TESTNET_USDC_ASSET_ID,
    amount: usdc('300').units,
    lease: NONCE,
    firstValid: 1_000n,
    lastValid: 1_050n,
    signatureValid: true,
    rekeyTo: null,
    closeRemainderTo: null,
    ...overrides,
  };
}

function payload(overrides: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    x402Version: 1,
    scheme: 'exact',
    network: 'algorand-testnet',
    signedTxn: 'gqNzaWfEQ...',
    nonce: NONCE,
    resource: 'run_1:pay_supplier',
    ...overrides,
  };
}

function context(overrides: Partial<VerificationContext> = {}): VerificationContext {
  return {
    requirements: requirements(),
    decoded: decoded(),
    now: T0 + 1_000,
    nonceAlreadyUsed: false,
    currentRound: 1_000n,
    ...overrides,
  };
}

/** Assert a refusal and return its code, for concise assertions. */
function codeOf(result: ReturnType<typeof verifyPayment>): string {
  if (result.ok) throw new Error('expected the payment to be refused');
  return result.code;
}

describe('the happy path', () => {
  it('accepts a well-formed exact payment', () => {
    const result = verifyPayment(payload(), context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount.units).toBe(usdc('300').units);
  });

  it('accepts an upto payment below the ceiling', () => {
    const result = verifyPayment(
      payload({ scheme: 'upto' }),
      context({
        requirements: requirements({ scheme: 'upto' }),
        decoded: decoded({ amount: usdc('180').units }),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount.units).toBe(usdc('180').units);
  });

  it('accepts an upto payment exactly at the ceiling', () => {
    const result = verifyPayment(
      payload({ scheme: 'upto' }),
      context({ requirements: requirements({ scheme: 'upto' }) }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('protocol framing', () => {
  it('refuses an unsupported protocol version', () => {
    expect(codeOf(verifyPayment(payload({ x402Version: 2 as never }), context()))).toBe(
      'VERSION_MISMATCH',
    );
  });

  it('refuses a scheme the requirements did not offer', () => {
    // Claiming `upto` against an `exact` quote would let a payer settle less.
    expect(codeOf(verifyPayment(payload({ scheme: 'upto' }), context()))).toBe('SCHEME_MISMATCH');
  });

  it('refuses a network mismatch', () => {
    expect(codeOf(verifyPayment(payload({ network: 'algorand-mainnet' }), context()))).toBe(
      'NETWORK_MISMATCH',
    );
  });

  it('refuses to settle on mainnet even when payload and requirements agree', () => {
    // A misconfigured env var must fail loudly rather than move real funds.
    const result = verifyPayment(
      payload({ network: 'algorand-mainnet' }),
      context({ requirements: requirements({ network: 'algorand-mainnet' }) }),
    );
    expect(codeOf(result)).toBe('NETWORK_FORBIDDEN');
  });
});

describe('request identity', () => {
  it('refuses a payload bearing a different nonce', () => {
    expect(codeOf(verifyPayment(payload({ nonce: OTHER_NONCE }), context()))).toBe(
      'NONCE_MISMATCH',
    );
  });

  it('refuses a payload for a different resource', () => {
    // Replaying a valid payment against a different step would buy the wrong
    // thing with a legitimate signature.
    expect(codeOf(verifyPayment(payload({ resource: 'run_1:pay_inspection' }), context()))).toBe(
      'RESOURCE_MISMATCH',
    );
  });

  it('refuses a duplicate settlement before anything reaches the chain', () => {
    expect(codeOf(verifyPayment(payload(), context({ nonceAlreadyUsed: true })))).toBe(
      'NONCE_ALREADY_USED',
    );
  });

  it('refuses an expired quote', () => {
    expect(
      codeOf(verifyPayment(payload(), context({ now: T0 + DEFAULT_REQUIREMENTS_TTL_MS }))),
    ).toBe('REQUIREMENTS_EXPIRED');
  });

  it('accepts one millisecond before expiry', () => {
    expect(
      verifyPayment(payload(), context({ now: T0 + DEFAULT_REQUIREMENTS_TTL_MS - 1 })).ok,
    ).toBe(true);
  });
});

describe('cryptography', () => {
  it('refuses an invalid signature', () => {
    expect(codeOf(verifyPayment(payload(), context({ decoded: decoded({ signatureValid: false }) })))).toBe(
      'BAD_SIGNATURE',
    );
  });
});

describe('the money', () => {
  it('refuses a payment redirected to another address', () => {
    // The payoff an injected "our banking details changed" is aiming for.
    expect(
      codeOf(verifyPayment(payload(), context({ decoded: decoded({ receiver: ATTACKER }) }))),
    ).toBe('WRONG_RECEIVER');
  });

  it('refuses a payment in the wrong asset', () => {
    // Paying 300 units of a worthless self-issued ASA instead of USDC.
    expect(
      codeOf(verifyPayment(payload(), context({ decoded: decoded({ assetId: 999 }) }))),
    ).toBe('WRONG_ASSET');
  });

  it('refuses an exact payment that is short', () => {
    expect(
      codeOf(
        verifyPayment(payload(), context({ decoded: decoded({ amount: usdc('299.999999').units }) })),
      ),
    ).toBe('AMOUNT_TOO_LOW');
  });

  it('refuses an exact payment that overpays', () => {
    expect(
      codeOf(
        verifyPayment(payload(), context({ decoded: decoded({ amount: usdc('300.000001').units }) })),
      ),
    ).toBe('AMOUNT_EXCEEDS_CEILING');
  });

  it('refuses an upto payment above the authorised ceiling', () => {
    // The provider raising its price after approval, caught at the payment
    // layer as well as the budget layer.
    const result = verifyPayment(
      payload({ scheme: 'upto' }),
      context({
        requirements: requirements({ scheme: 'upto' }),
        decoded: decoded({ amount: usdc('330').units }),
      }),
    );
    expect(codeOf(result)).toBe('AMOUNT_EXCEEDS_CEILING');
  });

  it('refuses a zero-value upto payment', () => {
    const result = verifyPayment(
      payload({ scheme: 'upto' }),
      context({
        requirements: requirements({ scheme: 'upto' }),
        decoded: decoded({ amount: 0n }),
      }),
    );
    expect(codeOf(result)).toBe('AMOUNT_TOO_LOW');
  });
});

describe('on-chain replay protection', () => {
  it('refuses a transaction with no lease', () => {
    // Without a lease the chain cannot reject a replay, leaving only our
    // database between a duplicate payload and a second transfer.
    expect(codeOf(verifyPayment(payload(), context({ decoded: decoded({ lease: null }) })))).toBe(
      'LEASE_MISSING',
    );
  });

  it('refuses a lease that is not the issued nonce', () => {
    expect(
      codeOf(verifyPayment(payload(), context({ decoded: decoded({ lease: OTHER_NONCE }) }))),
    ).toBe('LEASE_MISMATCH');
  });

  it('refuses an over-wide validity window', () => {
    const wide = decoded({ firstValid: 1_000n, lastValid: 1_000n + MAX_VALIDITY_ROUNDS + 1n });
    expect(codeOf(verifyPayment(payload(), context({ decoded: wide })))).toBe(
      'VALIDITY_WINDOW_TOO_WIDE',
    );
  });

  it('accepts a window exactly at the limit', () => {
    const atLimit = decoded({ firstValid: 1_000n, lastValid: 1_000n + MAX_VALIDITY_ROUNDS });
    expect(verifyPayment(payload(), context({ decoded: atLimit })).ok).toBe(true);
  });
});

describe('dangerous transaction shapes', () => {
  it('refuses a transaction that rekeys the sender', () => {
    // A rekey hands control of the paying account to a third party. It has
    // no legitimate place in a payment.
    expect(
      codeOf(verifyPayment(payload(), context({ decoded: decoded({ rekeyTo: ATTACKER }) }))),
    ).toBe('DANGEROUS_REKEY');
  });

  it('refuses a transaction that closes out the asset holding', () => {
    // A close-out sweeps the whole remaining balance alongside the payment.
    expect(
      codeOf(
        verifyPayment(payload(), context({ decoded: decoded({ closeRemainderTo: ATTACKER }) })),
      ),
    ).toBe('DANGEROUS_CLOSE');
  });
});

describe('buildRequirements', () => {
  it('sets expiry from the supplied clock', () => {
    expect(requirements().expiresAt).toBe(T0 + DEFAULT_REQUIREMENTS_TTL_MS);
  });

  it('defaults to TestNet USDC', () => {
    expect(requirements().assetId).toBe(TESTNET_USDC_ASSET_ID);
    expect(requirements().network).toBe('algorand-testnet');
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      buildRequirements({
        scheme: 'exact',
        payTo: PAYEE,
        maxAmountRequired: usdc('0'),
        nonce: NONCE,
        resource: 'r',
        description: 'd',
        now: T0,
      }),
    ).toThrow(ProtocolError);
  });

  it('rejects a malformed address', () => {
    expect(() =>
      buildRequirements({
        scheme: 'exact',
        payTo: 'not-an-address',
        maxAmountRequired: usdc('1'),
        nonce: NONCE,
        resource: 'r',
        description: 'd',
        now: T0,
      }),
    ).toThrow(/not an Algorand address/);
  });

  it('rejects a nonce that is not 32 bytes', () => {
    expect(() =>
      buildRequirements({
        scheme: 'exact',
        payTo: PAYEE,
        maxAmountRequired: usdc('1'),
        nonce: 'dG9vLXNob3J0',
        resource: 'r',
        description: 'd',
        now: T0,
      }),
    ).toThrow(/32 bytes/);
  });

  it('rejects an empty resource correlation id', () => {
    expect(() =>
      buildRequirements({
        scheme: 'exact',
        payTo: PAYEE,
        maxAmountRequired: usdc('1'),
        nonce: NONCE,
        resource: '',
        description: 'd',
        now: T0,
      }),
    ).toThrow(ProtocolError);
  });
});

describe('nonce and address shapes', () => {
  it('accepts a 32-byte base64 nonce and rejects others', () => {
    expect(isValidNonce(NONCE)).toBe(true);
    expect(isValidNonce('short')).toBe(false);
    expect(isValidNonce(`${NONCE}extra`)).toBe(false);
  });

  it('accepts a 58-character base32 address and rejects others', () => {
    expect(isPlausibleAddress(PAYEE)).toBe(true);
    expect(isPlausibleAddress('0x1234')).toBe(false);
    expect(isPlausibleAddress(PAYEE.slice(0, 57))).toBe(false);
  });
});

describe('the 402 body', () => {
  it('round-trips through serialisation', () => {
    const original = requirements();
    const [parsed] = parsePaymentRequiredBody(toPaymentRequiredBody([original]));
    expect(parsed?.maxAmountRequired.units).toBe(original.maxAmountRequired.units);
    expect(parsed?.nonce).toBe(original.nonce);
    expect(parsed?.scheme).toBe(original.scheme);
  });

  it('sends amounts as strings, not JSON numbers', () => {
    // A settlement above 2^53 micro-units would silently lose precision as a
    // double, and "silently" is the unacceptable part.
    const body = toPaymentRequiredBody([requirements()]);
    expect(typeof body.accepts[0]?.maxAmountRequired).toBe('string');
  });

  it('survives an amount beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = requirements({
      maxAmountRequired: { asset: 'USDC', units: 99_999_999_999_999_999n },
    });
    const [parsed] = parsePaymentRequiredBody(toPaymentRequiredBody([huge]));
    expect(parsed?.maxAmountRequired.units).toBe(99_999_999_999_999_999n);
  });

  it('rejects a body that is not an object', () => {
    expect(() => parsePaymentRequiredBody('nope')).toThrow(/must be an object/);
  });

  it('rejects an unsupported protocol version', () => {
    expect(() => parsePaymentRequiredBody({ x402Version: 2, accepts: [] })).toThrow(
      /unsupported x402Version/,
    );
  });

  it('rejects an empty accepts list', () => {
    expect(() => parsePaymentRequiredBody({ x402Version: 1, accepts: [] })).toThrow(
      /at least one accepted payment/,
    );
  });

  it('rejects an unknown scheme from a counterparty', () => {
    const body = toPaymentRequiredBody([requirements()]);
    const tampered = {
      ...body,
      accepts: [{ ...body.accepts[0], scheme: 'freebie' }],
    };
    expect(() => parsePaymentRequiredBody(tampered)).toThrow(/unsupported scheme/);
  });

  it('rejects a floating-point amount', () => {
    const body = toPaymentRequiredBody([requirements()]);
    const tampered = {
      ...body,
      accepts: [{ ...body.accepts[0], maxAmountRequired: '300.5' }],
    };
    expect(() => parsePaymentRequiredBody(tampered)).toThrow(/decimal string of minor units/);
  });

  it('rejects a negative amount expressed as a string', () => {
    const body = toPaymentRequiredBody([requirements()]);
    const tampered = {
      ...body,
      accepts: [{ ...body.accepts[0], maxAmountRequired: '-300000000' }],
    };
    expect(() => parsePaymentRequiredBody(tampered)).toThrow(ProtocolError);
  });

  it('rejects a malformed payTo from a counterparty', () => {
    const body = toPaymentRequiredBody([requirements()]);
    const tampered = { ...body, accepts: [{ ...body.accepts[0], payTo: 'evil' }] };
    expect(() => parsePaymentRequiredBody(tampered)).toThrow(/not an Algorand address/);
  });
});

describe('selectRequirement', () => {
  function option(overrides: Partial<PaymentRequirements>): PaymentRequirements {
    return requirements(overrides);
  }

  it('prefers the cheapest ceiling', () => {
    const chosen = selectRequirement(
      [
        option({ maxAmountRequired: usdc('300') }),
        option({ maxAmountRequired: usdc('180'), nonce: OTHER_NONCE }),
      ],
      { maxSpend: usdc('500'), now: T0 },
    );
    expect(chosen.maxAmountRequired.units).toBe(usdc('180').units);
  });

  it('prefers upto over exact at the same price, since it can only settle lower', () => {
    const chosen = selectRequirement(
      [option({ scheme: 'exact' }), option({ scheme: 'upto', nonce: OTHER_NONCE })],
      { maxSpend: usdc('500'), now: T0 },
    );
    expect(chosen.scheme).toBe('upto');
  });

  it('refuses every option above the spend cap', () => {
    expect(() =>
      selectRequirement([option({ maxAmountRequired: usdc('900') })], {
        maxSpend: usdc('500'),
        now: T0,
      }),
    ).toThrow(/within the/);
  });

  it('ignores expired options', () => {
    expect(() =>
      selectRequirement([option({})], { maxSpend: usdc('500'), now: T0 + 999_999 }),
    ).toThrow(/NO_VIABLE_OPTION|unexpired/);
  });

  it('refuses a mainnet option outright', () => {
    expect(() =>
      selectRequirement([option({ network: 'algorand-mainnet' })], {
        maxSpend: usdc('500'),
        now: T0,
      }),
    ).toThrow(ProtocolError);
  });

  it('is deterministic when options tie completely', () => {
    const a = option({ nonce: NONCE });
    const b = option({ nonce: OTHER_NONCE });
    const first = selectRequirement([a, b], { maxSpend: usdc('500'), now: T0 });
    const second = selectRequirement([b, a], { maxSpend: usdc('500'), now: T0 });
    expect(first.nonce).toBe(second.nonce);
  });
});

describe('isExpired', () => {
  it('treats the expiry instant as expired', () => {
    const req = requirements();
    expect(isExpired(req, req.expiresAt - 1)).toBe(false);
    expect(isExpired(req, req.expiresAt)).toBe(true);
  });
});

describe('explorerUrlFor', () => {
  it('points at the TestNet explorer so a judge can verify independently', () => {
    expect(explorerUrlFor('ABC123', 'algorand-testnet')).toBe('https://testnet.allo.info/tx/ABC123');
  });
});
