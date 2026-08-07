import { describe, expect, it } from 'vitest';
import {
  claim,
  DEFAULT_LEASE_TTL_MS,
  explainRefusal,
  isExpired,
  isHeldBy,
  type Lease,
  LeaseError,
  mayCommit,
  release,
  renew,
} from './lease.js';

const T0 = 1_700_000_000_000;

/** Claim helper that asserts success, for readability in the tests below. */
function take(current: Lease | null, owner: string, now: number, ttl?: number): Lease {
  const result = claim(current, owner, now, ttl);
  if (!result.ok) throw new Error(`expected claim to succeed: ${result.message}`);
  return result.lease;
}

describe('claim', () => {
  it('takes a free step', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(lease.owner).toBe('vercel:a');
    expect(lease.expiresAt).toBe(T0 + DEFAULT_LEASE_TTL_MS);
  });

  it('issues the first fencing token as 1', () => {
    expect(take(null, 'vercel:a', T0).fenceToken).toBe(1);
  });

  it('refuses a step already held by another runner', () => {
    const held = take(null, 'vercel:a', T0);
    const result = claim(held, 'worker:local', T0 + 1_000);
    expect(result).toMatchObject({ ok: false, reason: 'held_by_other' });
  });

  it('tells a runner to renew rather than re-claim its own lease', () => {
    const held = take(null, 'vercel:a', T0);
    expect(claim(held, 'vercel:a', T0 + 1_000)).toMatchObject({
      ok: false,
      reason: 'held_by_self',
    });
  });

  it('allows reclaim once the lease has expired', () => {
    const held = take(null, 'vercel:a', T0);
    const result = claim(held, 'worker:local', T0 + DEFAULT_LEASE_TTL_MS);
    expect(result.ok).toBe(true);
  });

  it('increments the fencing token on every reclaim', () => {
    const first = take(null, 'vercel:a', T0);
    const second = take(first, 'worker:local', T0 + DEFAULT_LEASE_TTL_MS);
    const third = take(second, 'cron:b', T0 + DEFAULT_LEASE_TTL_MS * 2);
    expect([first.fenceToken, second.fenceToken, third.fenceToken]).toEqual([1, 2, 3]);
  });

  it('rejects a non-positive TTL', () => {
    expect(() => claim(null, 'a', T0, 0)).toThrow(LeaseError);
  });

  it('rejects an empty owner', () => {
    expect(() => claim(null, '', T0)).toThrow(LeaseError);
  });
});

describe('the contention case: three runners, one step, one execution', () => {
  it('grants the step to exactly one of three concurrent claimants', () => {
    // All three tick sources fire at the same instant.
    const owners = ['vercel:sse', 'vercel:cron', 'worker:local'];
    let current: Lease | null = null;
    const winners: string[] = [];

    for (const owner of owners) {
      const result = claim(current, owner, T0);
      if (result.ok) {
        winners.push(owner);
        current = result.lease;
      }
    }

    expect(winners).toEqual(['vercel:sse']);
  });

  it('lets the next runner take over only after expiry, under a fresh token', () => {
    const first = take(null, 'vercel:sse', T0);
    expect(claim(first, 'worker:local', T0 + 30_000).ok).toBe(false);
    const second = take(first, 'worker:local', T0 + 60_000);
    expect(second.fenceToken).toBe(2);
  });
});

describe('the stalled-runner case', () => {
  it('discards a stale write from a runner that slept past its lease', () => {
    // A claims the step, then stalls on a cold start.
    const a = take(null, 'vercel:a', T0);
    // A's lease expires; B reclaims and starts working.
    const b = take(a, 'worker:local', T0 + DEFAULT_LEASE_TTL_MS);
    // A wakes up and tries to write its result with its old token.
    expect(mayCommit(b, 'vercel:a', a.fenceToken, T0 + DEFAULT_LEASE_TTL_MS + 5_000)).toBe(false);
    // B's write is accepted.
    expect(mayCommit(b, 'worker:local', b.fenceToken, T0 + DEFAULT_LEASE_TTL_MS + 5_000)).toBe(
      true,
    );
  });

  it('explains the rejection in terms a trace reader can act on', () => {
    const a = take(null, 'vercel:a', T0);
    const b = take(a, 'worker:local', T0 + DEFAULT_LEASE_TTL_MS);
    const reason = explainRefusal(b, 'vercel:a', a.fenceToken, T0 + DEFAULT_LEASE_TTL_MS + 1);
    expect(reason).toMatch(/stale fencing token 1/);
    expect(reason).toMatch(/reclaimed under token 2/);
  });

  it('refuses a commit whose lease expired even with the right token', () => {
    // Nobody reclaimed yet, but the holder is out of time: a reclaim could
    // land at any moment, so the write is not safe.
    const a = take(null, 'vercel:a', T0);
    expect(mayCommit(a, 'vercel:a', a.fenceToken, T0 + DEFAULT_LEASE_TTL_MS)).toBe(false);
    expect(explainRefusal(a, 'vercel:a', a.fenceToken, T0 + DEFAULT_LEASE_TTL_MS)).toMatch(
      /lease expired/,
    );
  });
});

describe('mayCommit', () => {
  it('accepts the holder presenting the live token inside the lease', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(mayCommit(lease, 'vercel:a', lease.fenceToken, T0 + 1_000)).toBe(true);
    expect(explainRefusal(lease, 'vercel:a', lease.fenceToken, T0 + 1_000)).toBeNull();
  });

  it('refuses a write against a step holding no lease', () => {
    expect(mayCommit(null, 'vercel:a', 1, T0)).toBe(false);
    expect(explainRefusal(null, 'vercel:a', 1, T0)).toMatch(/holds no lease/);
  });

  it('refuses a different owner even with a matching token', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(mayCommit(lease, 'worker:local', lease.fenceToken, T0 + 1_000)).toBe(false);
  });

  it('refuses a token from the future', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(mayCommit(lease, 'vercel:a', lease.fenceToken + 1, T0 + 1_000)).toBe(false);
  });
});

describe('renew', () => {
  it('extends the deadline for a long agent turn', () => {
    const lease = take(null, 'vercel:a', T0);
    const renewed = renew(lease, 'vercel:a', T0 + 40_000);
    expect(renewed.expiresAt).toBe(T0 + 40_000 + DEFAULT_LEASE_TTL_MS);
  });

  it('keeps the fencing token so in-flight writes stay valid', () => {
    // The holder never lost the step, so its pending write must still commit.
    const lease = take(null, 'vercel:a', T0);
    const renewed = renew(lease, 'vercel:a', T0 + 40_000);
    expect(renewed.fenceToken).toBe(lease.fenceToken);
    expect(mayCommit(renewed, 'vercel:a', lease.fenceToken, T0 + 50_000)).toBe(true);
  });

  it('refuses renewal by a runner that does not hold it', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(() => renew(lease, 'worker:local', T0 + 1_000)).toThrow(LeaseError);
  });

  it('refuses to resurrect an expired lease', () => {
    // Silently extending here would reintroduce the double-execution bug.
    const lease = take(null, 'vercel:a', T0);
    expect(() => renew(lease, 'vercel:a', T0 + DEFAULT_LEASE_TTL_MS)).toThrow(
      /may have been reclaimed/,
    );
  });
});

describe('release', () => {
  it('frees the step for immediate pickup', () => {
    const lease = take(null, 'vercel:a', T0);
    const released = release(lease, 'vercel:a', T0 + 5_000);
    expect(claim(released, 'worker:local', T0 + 5_000).ok).toBe(true);
  });

  it('preserves the fencing token so the next claim does not reuse it', () => {
    const lease = take(null, 'vercel:a', T0);
    const released = release(lease, 'vercel:a', T0 + 5_000);
    expect(take(released, 'worker:local', T0 + 5_000).fenceToken).toBe(2);
  });

  it('invalidates the releaser\'s own pending writes', () => {
    const lease = take(null, 'vercel:a', T0);
    const released = release(lease, 'vercel:a', T0 + 5_000);
    expect(mayCommit(released, 'vercel:a', lease.fenceToken, T0 + 5_000)).toBe(false);
  });

  it('refuses release by a non-holder', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(() => release(lease, 'worker:local', T0 + 1_000)).toThrow(LeaseError);
  });
});

describe('isExpired and isHeldBy', () => {
  it('treats the expiry instant itself as expired', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(isExpired(lease, T0 + DEFAULT_LEASE_TTL_MS - 1)).toBe(false);
    expect(isExpired(lease, T0 + DEFAULT_LEASE_TTL_MS)).toBe(true);
  });

  it('reports holding only for the live owner', () => {
    const lease = take(null, 'vercel:a', T0);
    expect(isHeldBy(lease, 'vercel:a', T0 + 1_000)).toBe(true);
    expect(isHeldBy(lease, 'worker:local', T0 + 1_000)).toBe(false);
    expect(isHeldBy(lease, 'vercel:a', T0 + DEFAULT_LEASE_TTL_MS)).toBe(false);
    expect(isHeldBy(null, 'vercel:a', T0)).toBe(false);
  });
});
