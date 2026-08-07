/**
 * Step leasing with fencing tokens.
 *
 * Three independent sources advance a workflow: the browser's SSE loop while
 * a user watches, a Vercel cron, and the optional local worker. The admin
 * panel can enable all three at once. Without mutual exclusion, two runners
 * would pick up the same `pay` step and settle it twice.
 *
 * A lease alone is not enough. The classic failure: runner A claims a step,
 * stalls (GC pause, cold start, network partition), its lease expires,
 * runner B claims and completes the step — then A wakes up and writes its
 * stale result over B's. A time-based lease cannot prevent this, because A
 * has no way to know it slept.
 *
 * So every lease carries a **fencing token**: a counter that strictly
 * increases each time the step is claimed. The store accepts a write only if
 * the token matches the current one. A's stale write arrives carrying an old
 * token and is rejected. This is what makes "exactly one execution" true
 * rather than merely likely.
 *
 * This module is pure and clock-injected: `now` is always a parameter, never
 * read from the ambient clock, so the eval harness can drive expiry
 * deterministically.
 */

export interface Lease {
  /** Identifier of the runner holding the lease (e.g. "vercel:iad1:a3f9"). */
  readonly owner: string;
  /** Epoch milliseconds when the lease was taken. */
  readonly acquiredAt: number;
  /** Epoch milliseconds after which the lease is void. */
  readonly expiresAt: number;
  /**
   * Strictly increasing per step. A write is valid only if it presents the
   * token that is currently live.
   */
  readonly fenceToken: number;
}

export type ClaimRejection =
  | 'held_by_other'
  | 'held_by_self'
  | 'clock_before_acquisition';

export type ClaimResult =
  | { readonly ok: true; readonly lease: Lease }
  | { readonly ok: false; readonly reason: ClaimRejection; readonly message: string };

export class LeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeaseError';
  }
}

/**
 * Default lease duration.
 *
 * Chosen against Vercel's execution ceiling: a tick must finish well inside
 * the function limit, so a lease longer than that would leave a step frozen
 * after a timeout, while a shorter one risks expiring under a slow LLM call.
 */
export const DEFAULT_LEASE_TTL_MS = 60_000;

export function isExpired(lease: Lease, now: number): boolean {
  return now >= lease.expiresAt;
}

export function isHeldBy(lease: Lease | null, owner: string, now: number): boolean {
  return lease !== null && lease.owner === owner && !isExpired(lease, now);
}

/**
 * Attempt to take the lease.
 *
 * A free step, or one whose lease has expired, may be claimed. Reclaiming
 * always mints a new fencing token, which is what invalidates the previous
 * holder's pending writes.
 */
export function claim(
  current: Lease | null,
  owner: string,
  now: number,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): ClaimResult {
  if (ttlMs <= 0) {
    throw new LeaseError(`lease TTL must be positive, received ${ttlMs}`);
  }
  if (owner === '') {
    throw new LeaseError('lease owner must be a non-empty identifier');
  }

  if (current && !isExpired(current, now)) {
    if (current.owner === owner) {
      return {
        ok: false,
        reason: 'held_by_self',
        message: `"${owner}" already holds this lease until ${current.expiresAt}; renew instead`,
      };
    }
    return {
      ok: false,
      reason: 'held_by_other',
      message:
        `lease is held by "${current.owner}" until ${current.expiresAt}; ` +
        `"${owner}" must wait or pick another step`,
    };
  }

  return {
    ok: true,
    lease: {
      owner,
      acquiredAt: now,
      expiresAt: now + ttlMs,
      // Monotonic across every claim of this step, including reclaims after
      // expiry. Never reset.
      fenceToken: (current?.fenceToken ?? 0) + 1,
    },
  };
}

/**
 * Extend a lease the caller still holds.
 *
 * Renewal deliberately keeps the same fencing token: the holder has not lost
 * the step, so its in-flight writes must stay valid. A long agent turn
 * renews rather than reclaiming.
 */
export function renew(
  current: Lease,
  owner: string,
  now: number,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): Lease {
  if (current.owner !== owner) {
    throw new LeaseError(
      `"${owner}" cannot renew a lease held by "${current.owner}"`,
    );
  }
  if (isExpired(current, now)) {
    throw new LeaseError(
      `"${owner}" cannot renew a lease that expired at ${current.expiresAt}; ` +
        'the step may have been reclaimed and must be re-acquired',
    );
  }
  return { ...current, expiresAt: now + ttlMs };
}

/** Release a lease early so another runner can pick the step up immediately. */
export function releaseLease(current: Lease, owner: string, now: number): Lease {
  if (current.owner !== owner) {
    throw new LeaseError(`"${owner}" cannot release a lease held by "${current.owner}"`);
  }
  // Expire it in place rather than clearing it: the fencing token must
  // survive, or the next claim would reissue a token already seen.
  return { ...current, expiresAt: now };
}

/**
 * Whether a write presenting `fenceToken` may be committed.
 *
 * The store calls this immediately before persisting a step result. It is
 * the single point that stops a stalled runner from overwriting fresher
 * work, so it checks the token *and* ownership *and* expiry.
 */
export function mayCommit(
  current: Lease | null,
  owner: string,
  fenceToken: number,
  now: number,
): boolean {
  if (current === null) return false;
  if (current.owner !== owner) return false;
  if (current.fenceToken !== fenceToken) return false;
  return !isExpired(current, now);
}

/** Explains a refused commit, for the trace. */
export function explainRefusal(
  current: Lease | null,
  owner: string,
  fenceToken: number,
  now: number,
): string | null {
  if (mayCommit(current, owner, fenceToken, now)) return null;
  if (current === null) {
    return `"${owner}" tried to commit with token ${fenceToken} but the step holds no lease`;
  }
  if (current.fenceToken !== fenceToken) {
    return (
      `"${owner}" presented stale fencing token ${fenceToken}; the step has since been ` +
      `reclaimed under token ${current.fenceToken}, so this result is discarded`
    );
  }
  if (current.owner !== owner) {
    return `"${owner}" tried to commit a step now leased to "${current.owner}"`;
  }
  return (
    `"${owner}" held a valid token but its lease expired at ${current.expiresAt} ` +
    `(now ${now}); the result is discarded to avoid racing a reclaim`
  );
}
