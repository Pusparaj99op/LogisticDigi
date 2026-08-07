import { describe, expect, it } from 'vitest';
import {
  add,
  applyBasisPoints,
  compare,
  formatAmount,
  formatMoney,
  fromJSON,
  fromUnits,
  greaterThan,
  MoneyError,
  multiply,
  parseAmount,
  subtract,
  sum,
  toJSON,
  zero,
} from './money.js';

describe('parseAmount', () => {
  it('scales a decimal string to minor units', () => {
    expect(parseAmount('USDC', '12.50').units).toBe(12_500_000n);
  });

  it('treats a bare integer as a whole unit amount', () => {
    expect(parseAmount('USDC', '7').units).toBe(7_000_000n);
  });

  it('preserves full precision at the decimal limit', () => {
    expect(parseAmount('USDC', '0.000001').units).toBe(1n);
  });

  it('handles amounts far beyond Number.MAX_SAFE_INTEGER minor units', () => {
    expect(parseAmount('USDC', '99999999999.999999').units).toBe(99_999_999_999_999_999n);
  });

  it('rejects more decimal places than the asset supports', () => {
    expect(() => parseAmount('USDC', '1.0000001')).toThrow(MoneyError);
  });

  it('rejects non-numeric input', () => {
    expect(() => parseAmount('USDC', '12.5 USDC')).toThrow(MoneyError);
  });

  it('parses negative amounts for refunds and compensation', () => {
    expect(parseAmount('USDC', '-3.25').units).toBe(-3_250_000n);
  });
});

describe('formatting', () => {
  it('round-trips through parse and format', () => {
    expect(formatAmount(parseAmount('USDC', '12.50'))).toBe('12.500000');
  });

  it('pads the fractional part to the asset precision', () => {
    expect(formatAmount(fromUnits('USDC', 1n))).toBe('0.000001');
  });

  it('keeps the sign on negative amounts', () => {
    expect(formatAmount(parseAmount('USDC', '-0.5'))).toBe('-0.500000');
  });

  it('appends the asset code for display', () => {
    expect(formatMoney(parseAmount('ALGO', '2.5'))).toBe('2.500000 ALGO');
  });
});

describe('arithmetic', () => {
  it('does not accumulate the floating point drift that breaks budget checks', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754; here it must be exact.
    const total = add(parseAmount('USDC', '0.1'), parseAmount('USDC', '0.2'));
    expect(total.units).toBe(parseAmount('USDC', '0.3').units);
  });

  it('subtracts to an exact zero', () => {
    const result = subtract(parseAmount('USDC', '10'), parseAmount('USDC', '10'));
    expect(result.units).toBe(0n);
  });

  it('multiplies a unit price by a quantity', () => {
    expect(multiply(parseAmount('USDC', '1.25'), 4).units).toBe(parseAmount('USDC', '5').units);
  });

  it('sums an empty list to zero', () => {
    expect(sum('USDC', []).units).toBe(zero('USDC').units);
  });

  it('sums a list of quotes', () => {
    const quotes = [parseAmount('USDC', '1.10'), parseAmount('USDC', '2.20')];
    expect(formatAmount(sum('USDC', quotes))).toBe('3.300000');
  });

  it('refuses to mix assets', () => {
    expect(() => add(parseAmount('USDC', '1'), parseAmount('ALGO', '1'))).toThrow(MoneyError);
  });

  it('rejects a fractional multiplier that would reintroduce floats', () => {
    expect(() => multiply(parseAmount('USDC', '10'), 1.5)).toThrow(MoneyError);
  });
});

describe('applyBasisPoints', () => {
  it('takes a 2.5% platform cut', () => {
    expect(formatAmount(applyBasisPoints(parseAmount('USDC', '100'), 250))).toBe('2.500000');
  });

  it('rounds down so the platform never over-charges', () => {
    // 1 micro-unit at 50% is 0.5 units, which must floor to 0.
    expect(applyBasisPoints(fromUnits('USDC', 1n), 5_000).units).toBe(0n);
  });

  it('rejects a negative rate', () => {
    expect(() => applyBasisPoints(parseAmount('USDC', '1'), -100)).toThrow(MoneyError);
  });
});

describe('comparison', () => {
  it('orders amounts', () => {
    expect(compare(parseAmount('USDC', '1'), parseAmount('USDC', '2'))).toBe(-1);
    expect(compare(parseAmount('USDC', '2'), parseAmount('USDC', '2'))).toBe(0);
    expect(greaterThan(parseAmount('USDC', '3'), parseAmount('USDC', '2'))).toBe(true);
  });

  it('detects a budget breach exactly at the cap boundary', () => {
    const cap = parseAmount('USDC', '50');
    expect(greaterThan(parseAmount('USDC', '50'), cap)).toBe(false);
    expect(greaterThan(parseAmount('USDC', '50.000001'), cap)).toBe(true);
  });
});

describe('fromUnits', () => {
  it('rejects a fractional minor-unit count', () => {
    expect(() => fromUnits('USDC', 1.5)).toThrow(MoneyError);
  });

  it('rejects a number beyond safe integer range', () => {
    expect(() => fromUnits('USDC', Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
});

describe('serialisation', () => {
  it('round-trips through the Firestore-safe form', () => {
    const original = parseAmount('USDC', '1234.567891');
    expect(fromJSON(toJSON(original)).units).toBe(original.units);
  });

  it('stores units as a string because Firestore cannot hold bigint', () => {
    expect(toJSON(parseAmount('USDC', '1'))).toEqual({ asset: 'USDC', units: '1000000' });
  });
});
