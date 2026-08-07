/**
 * Seeded pseudo-random source.
 *
 * `Math.random()` is banned throughout the simulator. The handbook requires
 * that a judge can re-run the same scenario and inspect the trace; that is
 * only true if the provider fleet produces byte-identical offers for a given
 * seed. Every random choice in a simulated run therefore flows through here.
 *
 * mulberry32: 32-bit state, high-quality distribution for this purpose, and
 * — crucially — trivially reimplementable, so a reviewer can verify a run
 * without trusting our binary.
 */

export class SeededRandom {
  #state: number;
  readonly seed: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new TypeError(`seed must be an integer, received ${seed}`);
    }
    this.seed = seed;
    // >>> 0 coerces to unsigned 32-bit, so negative seeds behave predictably.
    this.#state = seed >>> 0;
  }

  /** Fresh generator on the same seed, for replaying a sequence. */
  fork(): SeededRandom {
    return new SeededRandom(this.seed);
  }

  /** Derive an independent stream, so adding a provider cannot shift others. */
  derive(label: string): SeededRandom {
    let hash = this.seed >>> 0;
    for (let index = 0; index < label.length; index += 1) {
      hash = (Math.imul(hash ^ label.charCodeAt(index), 16_777_619) >>> 0) >>> 0;
    }
    return new SeededRandom(hash | 0);
  }

  /** Next float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new TypeError(`int bounds must be integers, received ${min}..${max}`);
    }
    if (max < min) {
      throw new RangeError(`int bounds are inverted: ${min}..${max}`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    if (max < min) {
      throw new RangeError(`float bounds are inverted: ${min}..${max}`);
    }
    return min + this.next() * (max - min);
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    if (probability < 0 || probability > 1) {
      throw new RangeError(`probability must be within 0..1, received ${probability}`);
    }
    return this.next() < probability;
  }

  /** Uniform choice from a non-empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('cannot pick from an empty list');
    }
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Weighted choice. Weights need not sum to 1 but must be non-negative. */
  pickWeighted<T>(entries: readonly (readonly [T, number])[]): T {
    if (entries.length === 0) {
      throw new RangeError('cannot pick from an empty list');
    }
    let total = 0;
    for (const [, weight] of entries) {
      if (weight < 0) throw new RangeError(`weights must be non-negative, received ${weight}`);
      total += weight;
    }
    if (total === 0) {
      throw new RangeError('at least one weight must be positive');
    }
    let roll = this.next() * total;
    for (const [item, weight] of entries) {
      roll -= weight;
      if (roll < 0) return item;
    }
    // Floating point can leave a vanishing remainder; the last positive
    // entry is the correct answer. Walked manually rather than with
    // findLast, which needs a newer lib target than the workspace sets.
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index] as readonly [T, number];
      if (entry[1] > 0) return entry[0];
    }
    throw new RangeError('at least one weight must be positive');
  }

  /** Fisher-Yates on a copy. The input is never mutated. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = this.int(0, index);
      [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
    }
    return copy;
  }

  /** `count` distinct items, or all of them when count exceeds the list. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
  }
}

/** Convenience for the common `new SeededRandom(seed)` call. */
export function seeded(seed: number): SeededRandom {
  return new SeededRandom(seed);
}
