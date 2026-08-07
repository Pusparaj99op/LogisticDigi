import { describe, expect, it } from 'vitest';
import { type SeededRandom, seeded } from './random.js';

describe('determinism — the property replay depends on', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = seeded(42);
    const b = seeded(42);
    const draw = (r: SeededRandom) => Array.from({ length: 20 }, () => r.next());
    expect(draw(a)).toEqual(draw(b));
  });

  it('produces different sequences for different seeds', () => {
    expect(seeded(1).next()).not.toBe(seeded(2).next());
  });

  it('replays from the start after fork', () => {
    const source = seeded(7);
    const first = [source.next(), source.next(), source.next()];
    const replayed = source.fork();
    expect([replayed.next(), replayed.next(), replayed.next()]).toEqual(first);
  });

  it('handles a negative seed without collapsing', () => {
    expect(seeded(-1).next()).not.toBe(seeded(1).next());
    expect(seeded(-1).next()).toBeGreaterThanOrEqual(0);
  });

  it('rejects a non-integer seed', () => {
    expect(() => seeded(1.5)).toThrow(TypeError);
  });
});

describe('derive — independent streams', () => {
  it('gives each label its own sequence', () => {
    const source = seeded(42);
    expect(source.derive('supplier').next()).not.toBe(source.derive('carrier').next());
  });

  it('is stable for the same label and seed', () => {
    expect(seeded(42).derive('supplier').next()).toBe(seeded(42).derive('supplier').next());
  });

  it('lets a new provider be added without shifting the others', () => {
    // If every provider drew from one shared stream, inserting a provider
    // would change every subsequent offer and invalidate stored baselines.
    const before = seeded(42).derive('carrier_north').next();
    const unrelated = seeded(42).derive('inspector_new');
    void unrelated.next();
    expect(seeded(42).derive('carrier_north').next()).toBe(before);
  });
});

describe('distribution bounds', () => {
  it('keeps next() within [0, 1)', () => {
    const random = seeded(99);
    for (let i = 0; i < 500; i += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int() inclusive of both bounds', () => {
    const random = seeded(3);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) seen.add(random.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('returns the only value when int bounds are equal', () => {
    expect(seeded(5).int(3, 3)).toBe(3);
  });

  it('rejects inverted int bounds', () => {
    expect(() => seeded(1).int(5, 2)).toThrow(RangeError);
  });

  it('rejects non-integer int bounds', () => {
    expect(() => seeded(1).int(0, 2.5)).toThrow(TypeError);
  });

  it('keeps float() within its range', () => {
    const random = seeded(11);
    for (let i = 0; i < 200; i += 1) {
      const value = random.float(2.5, 4.5);
      expect(value).toBeGreaterThanOrEqual(2.5);
      expect(value).toBeLessThan(4.5);
    }
  });
});

describe('chance', () => {
  it('is always false at probability 0 and always true at 1', () => {
    const random = seeded(21);
    for (let i = 0; i < 50; i += 1) {
      expect(random.chance(0)).toBe(false);
      expect(random.chance(1)).toBe(true);
    }
  });

  it('lands near the requested rate over many draws', () => {
    const random = seeded(2024);
    let hits = 0;
    for (let i = 0; i < 5_000; i += 1) if (random.chance(0.3)) hits += 1;
    expect(hits / 5_000).toBeGreaterThan(0.27);
    expect(hits / 5_000).toBeLessThan(0.33);
  });

  it('rejects a probability outside 0..1', () => {
    expect(() => seeded(1).chance(1.5)).toThrow(RangeError);
    expect(() => seeded(1).chance(-0.1)).toThrow(RangeError);
  });
});

describe('pick and pickWeighted', () => {
  it('picks only from the supplied list', () => {
    const random = seeded(8);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i += 1) expect(items).toContain(random.pick(items));
  });

  it('rejects an empty list', () => {
    expect(() => seeded(1).pick([])).toThrow(RangeError);
    expect(() => seeded(1).pickWeighted([])).toThrow(RangeError);
  });

  it('never picks a zero-weight entry', () => {
    const random = seeded(4);
    for (let i = 0; i < 200; i += 1) {
      expect(random.pickWeighted([['never', 0], ['always', 1]] as const)).toBe('always');
    }
  });

  it('respects relative weights', () => {
    const random = seeded(31);
    let heavy = 0;
    for (let i = 0; i < 4_000; i += 1) {
      if (random.pickWeighted([['heavy', 9], ['light', 1]] as const) === 'heavy') heavy += 1;
    }
    expect(heavy / 4_000).toBeGreaterThan(0.86);
  });

  it('rejects negative weights and an all-zero set', () => {
    expect(() => seeded(1).pickWeighted([['a', -1]] as const)).toThrow(RangeError);
    expect(() => seeded(1).pickWeighted([['a', 0]] as const)).toThrow(RangeError);
  });
});

describe('shuffle and sample', () => {
  it('does not mutate the input', () => {
    const items = ['a', 'b', 'c', 'd'];
    const snapshot = [...items];
    seeded(6).shuffle(items);
    expect(items).toEqual(snapshot);
  });

  it('preserves every element', () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(seeded(6).shuffle(items).sort((a, b) => a - b)).toEqual(items);
  });

  it('shuffles identically for the same seed', () => {
    const items = [1, 2, 3, 4, 5];
    expect(seeded(6).shuffle(items)).toEqual(seeded(6).shuffle(items));
  });

  it('samples distinct elements', () => {
    const sample = seeded(12).sample(['a', 'b', 'c', 'd', 'e'], 3);
    expect(sample).toHaveLength(3);
    expect(new Set(sample).size).toBe(3);
  });

  it('caps a sample at the list length', () => {
    expect(seeded(12).sample(['a', 'b'], 10)).toHaveLength(2);
  });

  it('returns nothing for a non-positive count', () => {
    expect(seeded(12).sample(['a', 'b'], 0)).toEqual([]);
    expect(seeded(12).sample(['a', 'b'], -3)).toEqual([]);
  });
});
