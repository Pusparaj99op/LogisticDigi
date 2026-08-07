/**
 * Money as integer minor units.
 *
 * Every amount in the orchestrator — quotes, budget caps, reservations,
 * settled payments — flows through this type. Floating point is banned
 * outright: a 0.1 + 0.2 drift in a budget check is a spend-control failure,
 * and on-chain assets are integer-denominated anyway (USDC on Algorand has
 * 6 decimals and is transferred as whole micro-units).
 */

/** Assets the orchestrator can denominate value in. */
export type AssetCode = 'USDC' | 'ALGO';

/** Decimal places each asset uses on-chain. */
export const ASSET_DECIMALS: Readonly<Record<AssetCode, number>> = Object.freeze({
  USDC: 6,
  ALGO: 6,
});

/**
 * An amount of a single asset, held as a bigint count of that asset's
 * smallest indivisible unit (microUSDC, microALGO).
 */
export interface Money {
  readonly asset: AssetCode;
  readonly units: bigint;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Construct Money directly from minor units. */
export function fromUnits(asset: AssetCode, units: bigint | number): Money {
  if (typeof units === 'number') {
    if (!Number.isInteger(units)) {
      throw new MoneyError(`minor units must be an integer, received ${units}`);
    }
    if (!Number.isSafeInteger(units)) {
      throw new MoneyError(`minor units ${units} exceeds safe integer range; pass a bigint`);
    }
  }
  return { asset, units: BigInt(units) };
}

/**
 * Parse a human decimal string ("12.50") into Money.
 *
 * Takes a string rather than a number on purpose: accepting 12.1 as a JS
 * number has already lost precision before this function can object.
 */
export function parseAmount(asset: AssetCode, amount: string): Money {
  const decimals = ASSET_DECIMALS[asset];
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) {
    throw new MoneyError(`"${amount}" is not a valid decimal amount`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new MoneyError(
      `${asset} supports ${decimals} decimal places, but "${amount}" has ${fraction.length}`,
    );
  }
  const padded = fraction.padEnd(decimals, '0');
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === '' ? '0' : padded);
  return { asset, units: sign === '-' ? -units : units };
}

/** Render Money as a fixed-precision decimal string, e.g. "12.500000". */
export function formatAmount(money: Money): string {
  const decimals = ASSET_DECIMALS[money.asset];
  const negative = money.units < 0n;
  const abs = negative ? -money.units : money.units;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Human-facing rendering with the asset code, e.g. "12.500000 USDC". */
export function formatMoney(money: Money): string {
  return `${formatAmount(money)} ${money.asset}`;
}

function assertSameAsset(a: Money, b: Money, operation: string): void {
  if (a.asset !== b.asset) {
    throw new MoneyError(`cannot ${operation} ${a.asset} and ${b.asset}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameAsset(a, b, 'add');
  return { asset: a.asset, units: a.units + b.units };
}

export function subtract(a: Money, b: Money): Money {
  assertSameAsset(a, b, 'subtract');
  return { asset: a.asset, units: a.units - b.units };
}

/** Scale by a whole multiplier, e.g. unit price times quantity. */
export function multiply(money: Money, factor: bigint | number): Money {
  if (typeof factor === 'number' && !Number.isInteger(factor)) {
    throw new MoneyError(`factor must be an integer, received ${factor}; use applyBasisPoints`);
  }
  return { asset: money.asset, units: money.units * BigInt(factor) };
}

/**
 * Apply a rate expressed in basis points (1 bp = 0.01%), rounding down.
 *
 * This is how platform fees on the Free tier are taken: a percentage cut
 * expressed without ever introducing a fractional multiplier. Rounding down
 * means the platform never over-charges on a rounding boundary.
 */
export function applyBasisPoints(money: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`basis points must be a non-negative integer, received ${basisPoints}`);
  }
  return { asset: money.asset, units: (money.units * BigInt(basisPoints)) / 10_000n };
}

/** Returns -1, 0, or 1 — the standard comparator contract. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameAsset(a, b, 'compare');
  if (a.units < b.units) return -1;
  if (a.units > b.units) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.asset === b.asset && a.units === b.units;
}

export function greaterThan(a: Money, b: Money): boolean {
  return compare(a, b) === 1;
}

export function lessThan(a: Money, b: Money): boolean {
  return compare(a, b) === -1;
}

export function isZero(money: Money): boolean {
  return money.units === 0n;
}

export function isNegative(money: Money): boolean {
  return money.units < 0n;
}

export function zero(asset: AssetCode): Money {
  return { asset, units: 0n };
}

export function sum(asset: AssetCode, amounts: readonly Money[]): Money {
  return amounts.reduce<Money>((total, amount) => add(total, amount), zero(asset));
}

export function min(a: Money, b: Money): Money {
  return lessThan(a, b) ? a : b;
}

export function max(a: Money, b: Money): Money {
  return greaterThan(a, b) ? a : b;
}

/**
 * Serialise for Firestore, which cannot store bigint.
 *
 * The string form is lossless and sorts correctly for equal-length values;
 * queries that need ordering should range on a separate numeric field rather
 * than relying on lexical order here.
 */
export function toJSON(money: Money): { asset: AssetCode; units: string } {
  return { asset: money.asset, units: money.units.toString() };
}

export function fromJSON(value: { asset: AssetCode; units: string }): Money {
  return { asset: value.asset, units: BigInt(value.units) };
}
