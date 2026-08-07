/**
 * x402 payment requirements: what a resource server returns with HTTP 402.
 *
 * The flow this implements, per docs.x402.org:
 *
 *   1. client requests a paid resource
 *   2. server responds 402 with `PaymentRequirements`
 *   3. client builds a signed payment payload and retries with it
 *   4. server verifies the payload, locally or via a facilitator
 *   5. server settles, then serves the resource
 *
 * We implement a compatible subset and document it precisely, as the
 * handbook requires: scheme `exact` and `upto`, network `algorand-testnet`,
 * asset USDC (ASA 10458941), with our own facilitator.
 *
 * This module is pure — no network, no chain, no clock. It defines the
 * contract and validates it. Everything that touches Algorand lives in
 * `algorand.ts`, so the protocol rules can be tested exhaustively offline.
 */

import { type AssetCode, formatMoney, isNegative, isZero, type Money } from '@logisticdigi/core';

/**
 * Payment schemes.
 *
 * `exact`  — a fixed price for one request. The client authorises precisely
 *            this amount and the server settles precisely this amount.
 * `upto`   — usage-based. The client authorises a ceiling; the server settles
 *            the actual amount consumed, which must be at or below it.
 *
 * Negotiated freight needs both: a booked consignment is `exact`, while a
 * metered inspection or per-kilometre haul is `upto`.
 */
export type Scheme = 'exact' | 'upto';

export type Network = 'algorand-testnet' | 'algorand-mainnet';

/**
 * The only network this build will settle on.
 *
 * MainNet is representable in the type so that a mismatch is a *detected*
 * refusal rather than an unrepresentable state — but it is never permitted.
 * The handbook is explicit that demonstrations must not touch real funds,
 * and a typo in an env var should fail loudly rather than move money.
 */
export const PERMITTED_NETWORK: Network = 'algorand-testnet';

/** USDC on Algorand TestNet. */
export const TESTNET_USDC_ASSET_ID = 10_458_941;

export interface PaymentRequirements {
  readonly scheme: Scheme;
  readonly network: Network;
  /** Algorand ASA id of the payment asset. */
  readonly assetId: number;
  readonly asset: AssetCode;
  /** Address that must receive the funds. */
  readonly payTo: string;
  /**
   * For `exact`, the precise amount due. For `upto`, the ceiling the client
   * authorises. Never negative, never zero.
   */
  readonly maxAmountRequired: Money;
  /**
   * Single-use 32-byte value, base64. Bound into the transaction's lease
   * field, which is what gives replay protection on-chain rather than only
   * in our database.
   */
  readonly nonce: string;
  /** Epoch ms after which the requirements are void. */
  readonly expiresAt: number;
  /** Opaque server-side correlation id (our runId:stepId). */
  readonly resource: string;
  /** Human-readable, shown at the approval gate. */
  readonly description: string;
}

export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/** A nonce is 32 raw bytes, carried as base64 (44 chars with padding). */
const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Algorand addresses are 58 characters of base32 (RFC 4648, no padding).
 *
 * Checksum validation belongs to algosdk; this catches the shape so the pure
 * layer can reject obvious nonsense without pulling in the chain SDK.
 */
const ALGORAND_ADDRESS = /^[A-Z2-7]{58}$/;

export function isValidNonce(nonce: string): boolean {
  return BASE64_32_BYTES.test(nonce);
}

export function isPlausibleAddress(address: string): boolean {
  return ALGORAND_ADDRESS.test(address);
}

export interface BuildRequirementsInput {
  readonly scheme: Scheme;
  readonly payTo: string;
  readonly maxAmountRequired: Money;
  readonly nonce: string;
  readonly resource: string;
  readonly description: string;
  readonly now: number;
  /** How long the quote stands. Short by design; see below. */
  readonly ttlMs?: number;
  readonly network?: Network;
  readonly assetId?: number;
}

/**
 * Default quote lifetime.
 *
 * Deliberately short. A payment authorisation is a standing offer to move
 * funds, and the longer it stands the wider the window in which a stale
 * price, a changed policy, or a withdrawn approval can be exploited. Two
 * minutes is comfortably longer than a settlement round trip on Algorand
 * (~3s finality) and far shorter than a human approval, which is why an
 * approval gate re-quotes rather than holding one open.
 */
export const DEFAULT_REQUIREMENTS_TTL_MS = 120_000;

export function buildRequirements(input: BuildRequirementsInput): PaymentRequirements {
  const network = input.network ?? PERMITTED_NETWORK;
  const amount = input.maxAmountRequired;

  if (isNegative(amount) || isZero(amount)) {
    throw new ProtocolError(
      'INVALID_AMOUNT',
      `payment requirements must name a positive amount, received ${formatMoney(amount)}`,
    );
  }
  if (!isPlausibleAddress(input.payTo)) {
    throw new ProtocolError('INVALID_PAYTO', `"${input.payTo}" is not an Algorand address`);
  }
  if (!isValidNonce(input.nonce)) {
    throw new ProtocolError(
      'INVALID_NONCE',
      'nonce must be 32 bytes encoded as base64; it is bound to the transaction lease',
    );
  }
  if (input.resource === '') {
    throw new ProtocolError('INVALID_RESOURCE', 'resource correlation id must not be empty');
  }

  const ttl = input.ttlMs ?? DEFAULT_REQUIREMENTS_TTL_MS;
  if (ttl <= 0) {
    throw new ProtocolError('INVALID_TTL', `requirements TTL must be positive, received ${ttl}`);
  }

  return {
    scheme: input.scheme,
    network,
    assetId: input.assetId ?? TESTNET_USDC_ASSET_ID,
    asset: amount.asset,
    payTo: input.payTo,
    maxAmountRequired: amount,
    nonce: input.nonce,
    expiresAt: input.now + ttl,
    resource: input.resource,
    description: input.description,
  };
}

export function isExpired(requirements: PaymentRequirements, now: number): boolean {
  return now >= requirements.expiresAt;
}

/** The JSON body served with a 402, ready to send over the wire. */
export interface PaymentRequiredBody {
  readonly x402Version: 1;
  readonly accepts: readonly {
    readonly scheme: Scheme;
    readonly network: Network;
    readonly asset: string;
    readonly assetId: number;
    readonly payTo: string;
    readonly maxAmountRequired: string;
    readonly nonce: string;
    readonly expiresAt: number;
    readonly resource: string;
    readonly description: string;
  }[];
  readonly error: string | null;
}

/**
 * Render requirements as the 402 response body.
 *
 * Amounts go over the wire as decimal strings of minor units, never as JSON
 * numbers: a settlement above 2^53 micro-units would silently lose precision
 * as a double, and "silently" is the unacceptable part.
 */
export function toPaymentRequiredBody(
  requirements: readonly PaymentRequirements[],
  error: string | null = null,
): PaymentRequiredBody {
  return {
    x402Version: 1,
    accepts: requirements.map((requirement) => ({
      scheme: requirement.scheme,
      network: requirement.network,
      asset: requirement.asset,
      assetId: requirement.assetId,
      payTo: requirement.payTo,
      maxAmountRequired: requirement.maxAmountRequired.units.toString(),
      nonce: requirement.nonce,
      expiresAt: requirement.expiresAt,
      resource: requirement.resource,
      description: requirement.description,
    })),
    error,
  };
}

/**
 * Parse a 402 body back into requirements.
 *
 * Written defensively: this parses a response from a *counterparty's* server,
 * which is untrusted input. Every field is checked rather than cast.
 */
export function parsePaymentRequiredBody(body: unknown): readonly PaymentRequirements[] {
  if (typeof body !== 'object' || body === null) {
    throw new ProtocolError('MALFORMED_BODY', '402 body must be an object');
  }
  const record = body as Record<string, unknown>;
  if (record.x402Version !== 1) {
    throw new ProtocolError(
      'UNSUPPORTED_VERSION',
      `unsupported x402Version ${String(record.x402Version)}; this build speaks version 1`,
    );
  }
  if (!Array.isArray(record.accepts) || record.accepts.length === 0) {
    throw new ProtocolError('MALFORMED_BODY', '402 body must list at least one accepted payment');
  }

  return record.accepts.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ProtocolError('MALFORMED_BODY', `accepts[${index}] is not an object`);
    }
    const item = entry as Record<string, unknown>;

    const scheme = item.scheme;
    if (scheme !== 'exact' && scheme !== 'upto') {
      throw new ProtocolError('UNSUPPORTED_SCHEME', `unsupported scheme "${String(scheme)}"`);
    }
    const network = item.network;
    if (network !== 'algorand-testnet' && network !== 'algorand-mainnet') {
      throw new ProtocolError('UNSUPPORTED_NETWORK', `unsupported network "${String(network)}"`);
    }
    const asset = item.asset;
    if (asset !== 'USDC' && asset !== 'ALGO') {
      throw new ProtocolError('UNSUPPORTED_ASSET', `unsupported asset "${String(asset)}"`);
    }
    if (typeof item.payTo !== 'string' || !isPlausibleAddress(item.payTo)) {
      throw new ProtocolError('INVALID_PAYTO', 'payTo is not an Algorand address');
    }
    if (typeof item.nonce !== 'string' || !isValidNonce(item.nonce)) {
      throw new ProtocolError('INVALID_NONCE', 'nonce is not 32 base64-encoded bytes');
    }
    if (typeof item.maxAmountRequired !== 'string' || !/^\d+$/.test(item.maxAmountRequired)) {
      throw new ProtocolError(
        'INVALID_AMOUNT',
        'maxAmountRequired must be a decimal string of minor units',
      );
    }
    const units = BigInt(item.maxAmountRequired);
    if (units <= 0n) {
      throw new ProtocolError('INVALID_AMOUNT', 'maxAmountRequired must be positive');
    }
    if (typeof item.expiresAt !== 'number' || !Number.isFinite(item.expiresAt)) {
      throw new ProtocolError('INVALID_EXPIRY', 'expiresAt must be an epoch timestamp');
    }
    if (typeof item.assetId !== 'number' || !Number.isInteger(item.assetId)) {
      throw new ProtocolError('INVALID_ASSET_ID', 'assetId must be an integer ASA id');
    }

    return {
      scheme,
      network,
      assetId: item.assetId,
      asset,
      payTo: item.payTo,
      maxAmountRequired: { asset, units },
      nonce: item.nonce,
      expiresAt: item.expiresAt,
      resource: typeof item.resource === 'string' ? item.resource : '',
      description: typeof item.description === 'string' ? item.description : '',
    } satisfies PaymentRequirements;
  });
}

/**
 * Choose which of several offered payment options to pay.
 *
 * Prefers the cheapest ceiling, and `upto` over `exact` at equal price
 * because `upto` can only ever settle for less. Refuses outright anything on
 * a network this build will not settle on.
 */
export function selectRequirement(
  options: readonly PaymentRequirements[],
  constraints: { readonly maxSpend: Money; readonly now: number },
): PaymentRequirements {
  const viable = options.filter(
    (option) =>
      option.network === PERMITTED_NETWORK &&
      option.asset === constraints.maxSpend.asset &&
      !isExpired(option, constraints.now) &&
      option.maxAmountRequired.units <= constraints.maxSpend.units,
  );

  if (viable.length === 0) {
    throw new ProtocolError(
      'NO_VIABLE_OPTION',
      `none of the ${options.length} offered payment option(s) are on ${PERMITTED_NETWORK}, ` +
        `unexpired, and within the ${formatMoney(constraints.maxSpend)} cap`,
    );
  }

  return [...viable].sort((a, b) => {
    if (a.maxAmountRequired.units !== b.maxAmountRequired.units) {
      return a.maxAmountRequired.units < b.maxAmountRequired.units ? -1 : 1;
    }
    if (a.scheme !== b.scheme) return a.scheme === 'upto' ? -1 : 1;
    return a.nonce.localeCompare(b.nonce);
  })[0] as PaymentRequirements;
}
