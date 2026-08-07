import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount, scanText } from '@logisticdigi/core';
import {
  DEFAULT_FLEET,
  gradeFor,
  hasConflictingQuality,
  isQuoteExpired,
  ProviderFleet,
  ProviderTimeout,
} from './providers.js';

const T0 = 1_700_000_000_000;
const usdc = (amount: string) => parseAmount('USDC', amount);

function fleet(seed = 42): ProviderFleet {
  return new ProviderFleet(seed);
}

/** Search once so the fleet knows its offers, then return them. */
function offers(instance: ProviderFleet, at = T0) {
  return instance.search('chilled cargo', { at });
}

describe('fleet composition', () => {
  it('covers every hard-mode behaviour the handbook names', () => {
    const behaviours = new Set(DEFAULT_FLEET.flatMap((profile) => profile.behaviours));
    for (const required of [
      'stale_quote',
      'raise_price_after_approval',
      'partial_result',
      'conflicting_quality',
      'injection_in_terms',
      'silent_timeout',
      'refuse_refund',
    ]) {
      expect(behaviours).toContain(required);
    }
  });

  it('includes honest providers, so a scenario is not uniformly hostile', () => {
    const honest = DEFAULT_FLEET.filter((profile) => profile.behaviours.includes('honest'));
    expect(honest.length).toBeGreaterThanOrEqual(3);
  });

  it('offers all three provider kinds', () => {
    const kinds = new Set(DEFAULT_FLEET.map((profile) => profile.kind));
    expect([...kinds].sort()).toEqual(['carrier', 'inspector', 'supplier']);
  });
});

/** Money holds bigint, which JSON.stringify refuses; render it as a string. */
function snapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

describe('determinism', () => {
  it('produces identical offers for the same seed and time', () => {
    expect(snapshot(offers(fleet(7)))).toBe(snapshot(offers(fleet(7))));
  });

  it('produces different offers for a different seed', () => {
    expect(snapshot(offers(fleet(7)))).not.toBe(snapshot(offers(fleet(8))));
  });

  it('keeps one provider\'s offer stable when another is removed from the fleet', () => {
    // Per-provider derived streams mean fleet composition changes do not
    // invalidate stored baselines for the remaining providers.
    const full = new ProviderFleet(7, DEFAULT_FLEET);
    const trimmed = new ProviderFleet(7, DEFAULT_FLEET.filter((p) => p.id !== 'sup_meridian'));
    const pick = (list: readonly { providerId: string; price: { units: bigint } }[]) =>
      list.find((offer) => offer.providerId === 'sup_northwind')?.price.units;
    expect(pick(offers(trimmed))).toBe(pick(offers(full)));
  });
});

describe('search', () => {
  it('returns one offer per matching provider', () => {
    expect(offers(fleet())).toHaveLength(DEFAULT_FLEET.length);
  });

  it('filters by provider kind', () => {
    const carriers = fleet().search('freight', { at: T0, kind: 'carrier' });
    expect(carriers.every((offer) => offer.kind === 'carrier')).toBe(true);
  });

  it('orders by price ascending, breaking ties deterministically', () => {
    const list = offers(fleet());
    const prices = list.map((offer) => offer.price.units);
    expect([...prices].sort((a, b) => Number(a - b))).toEqual(prices);
  });

  it('respects a result limit', () => {
    expect(fleet().search('x', { at: T0, limit: 3 })).toHaveLength(3);
  });

  it('prices in whole minor units with no floating point residue', () => {
    for (const offer of offers(fleet())) {
      expect(typeof offer.price.units).toBe('bigint');
      expect(formatMoney(offer.price)).toMatch(/^\d+\.\d{6} USDC$/);
    }
  });

  it('issues both exact and upto offers', () => {
    // Both x402 schemes must appear or the payment adapter is under-tested.
    const schemes = new Set(offers(fleet(3)).map((offer) => offer.scheme));
    expect(schemes.size).toBe(2);
  });
});

describe('stale quotes', () => {
  it('backdates expiry so the quote is dead on arrival', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'sup_meridian');
    const quote = instance.quote(offer!.id, T0);
    expect(quote.stale).toBe(true);
    expect(isQuoteExpired(quote, T0)).toBe(true);
  });

  it('leaves an honest provider\'s quote usable', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'sup_northwind');
    const quote = instance.quote(offer!.id, T0);
    expect(quote.stale).toBe(false);
    expect(isQuoteExpired(quote, T0)).toBe(false);
  });

  it('treats the expiry instant itself as expired', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'sup_northwind');
    const quote = instance.quote(offer!.id, T0);
    expect(isQuoteExpired(quote, quote.expiresAt)).toBe(true);
  });
});

describe('price raised after approval', () => {
  it('demands more than was approved', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'sup_kestrel');
    const demand = instance.demandSettlement(offer!.id, usdc('200'));
    expect(demand.raised).toBe(true);
    expect(demand.amount.units).toBeGreaterThan(usdc('200').units);
  });

  it('honours the approved amount for an honest provider', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'sup_northwind');
    const demand = instance.demandSettlement(offer!.id, usdc('200'));
    expect(demand.raised).toBe(false);
    expect(demand.amount.units).toBe(usdc('200').units);
  });
});

describe('fulfilment', () => {
  it('delivers a complete artifact from an honest provider', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'car_atlas');
    const result = instance.fulfil(offer!.id, T0 + 1_000);
    expect(result.complete).toBe(true);
    expect(result.artifact).toHaveProperty('certificateHash');
    expect(result.artifact).toHaveProperty('sealIntact');
  });

  it('omits the fields a verifier needs on a partial result', () => {
    // Subtler than returning nothing: the artifact looks plausible.
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'car_borealis');
    const result = instance.fulfil(offer!.id, T0 + 1_000);
    expect(result.complete).toBe(false);
    expect(result.artifact).not.toHaveProperty('certificateHash');
    expect(result.artifact).toHaveProperty('deliveredUnits');
  });

  it('produces self-contradictory metadata from the conflicting provider', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'ins_hollow');
    const result = instance.fulfil(offer!.id, T0 + 1_000);
    expect(hasConflictingQuality(result.artifact)).toBe(true);
    expect(result.measuredQuality).toBeNull();
  });

  it('produces internally consistent metadata from honest providers', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'ins_verity');
    const result = instance.fulfil(offer!.id, T0 + 1_000);
    expect(hasConflictingQuality(result.artifact)).toBe(false);
  });

  it('never lets a non-conflicting provider self-contradict, across many seeds', () => {
    // A false positive here would be scored against the verifier in the eval,
    // so the invariant is checked broadly rather than at one lucky seed.
    for (let seed = 0; seed < 60; seed += 1) {
      const instance = fleet(seed);
      for (const offer of offers(instance)) {
        if (instance.has(offer.providerId, 'conflicting_quality')) continue;
        if (instance.has(offer.providerId, 'silent_timeout')) continue;
        const result = instance.fulfil(offer.id, T0 + 1_000);
        expect(hasConflictingQuality(result.artifact)).toBe(false);
      }
    }
  });
});

describe('gradeFor', () => {
  it('assigns the best grade a defect rate honestly supports', () => {
    expect(gradeFor(0)).toBe('A');
    expect(gradeFor(0.1)).toBe('A');
    expect(gradeFor(0.11)).toBe('B');
    expect(gradeFor(0.25)).toBe('B');
    expect(gradeFor(0.4)).toBe('C');
    expect(gradeFor(0.9)).toBe('D');
  });

  it('agrees with the conflict check at every boundary', () => {
    // The two functions read the same table; this pins that they stay paired.
    for (const defectRate of [0, 0.1, 0.100001, 0.25, 0.3, 0.5, 0.51, 1]) {
      const grade = gradeFor(defectRate);
      expect(hasConflictingQuality({ declaredGrade: grade, defectRate })).toBe(false);
    }
  });
});

describe('hasConflictingQuality', () => {
  it('flags a grade its own defect rate contradicts', () => {
    expect(hasConflictingQuality({ declaredGrade: 'A', defectRate: 0.3 })).toBe(true);
  });

  it('accepts a defect rate within the grade\'s ceiling', () => {
    expect(hasConflictingQuality({ declaredGrade: 'A', defectRate: 0.05 })).toBe(false);
    expect(hasConflictingQuality({ declaredGrade: 'C', defectRate: 0.4 })).toBe(false);
  });

  it('reports nothing when either field is missing or malformed', () => {
    expect(hasConflictingQuality({ declaredGrade: 'A' })).toBe(false);
    expect(hasConflictingQuality({ defectRate: 0.9 })).toBe(false);
    expect(hasConflictingQuality({ declaredGrade: 'Z', defectRate: 0.9 })).toBe(false);
  });
});

describe('prompt injection in offer terms', () => {
  it('embeds a payload the core scanner detects', () => {
    // End-to-end proof that the simulator's attack and the orchestrator's
    // defence are talking about the same thing.
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'ins_hollow');
    expect(scanText(offer!.terms).verdict).not.toBe('clean');
  });

  it('leaves honest providers\' terms clean', () => {
    const instance = fleet();
    for (const offer of offers(instance)) {
      if (instance.has(offer.providerId, 'injection_in_terms')) continue;
      expect(scanText(offer.terms).verdict).toBe('clean');
    }
  });
});

describe('silent timeout', () => {
  it('throws rather than hanging, so the step can fail cleanly', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'car_silt');
    expect(() => instance.quote(offer!.id, T0)).toThrow(ProviderTimeout);
    expect(() => instance.fulfil(offer!.id, T0)).toThrow(ProviderTimeout);
  });

  it('names the provider in the error', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'car_silt');
    try {
      instance.quote(offer!.id, T0);
      throw new Error('expected a timeout');
    } catch (error) {
      expect((error as ProviderTimeout).providerId).toBe('car_silt');
    }
  });
});

describe('refunds and compensation', () => {
  it('returns the full amount from an honest provider', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'sup_northwind');
    expect(instance.requestRefund(offer!.id, usdc('100')).agreed.units).toBe(usdc('100').units);
  });

  it('returns nothing when the provider disputes the claim', () => {
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'sup_kestrel');
    const result = instance.requestRefund(offer!.id, usdc('100'));
    expect(result.agreed.units).toBe(0n);
    expect(result.reason).toContain('disputes');
  });

  it('returns half on a partial-delivery dispute', () => {
    // The partial-refund case the handbook asks the ledger to close correctly.
    const instance = fleet();
    const offer = offers(instance).find((o) => o.providerId === 'car_borealis');
    expect(instance.requestRefund(offer!.id, usdc('100')).agreed.units).toBe(usdc('50').units);
  });
});

describe('unknown offers', () => {
  it('refuses to quote an offer that was never published', () => {
    expect(() => fleet().quote('of_made_up', T0)).toThrow(/unknown to the fleet/);
  });
});
