/**
 * Budget and spend control.
 *
 * The orchestrator authorises money-moving steps in two phases:
 *
 *   reserve  — funds are earmarked when a quote is accepted, before the
 *              402 exchange. Reserved funds are unavailable to other steps.
 *   settle   — the actual on-chain amount is recorded once a receipt exists.
 *              Under the x402 `upto` scheme the settled amount may be less
 *              than reserved; it may never be more.
 *
 * That last rule is the defence against the handbook's hard-mode case
 * "provider changes offer after approval". A provider that returns a higher
 * price than the one a human approved cannot settle against the old
 * reservation — the excess is denied, not silently absorbed.
 *
 * This module is pure: every operation returns a new state plus an event.
 * That is what lets the eval harness replay a spend sequence and diff it.
 */

import {
  add,
  type AssetCode,
  formatMoney,
  greaterThan,
  isNegative,
  isZero,
  type Money,
  subtract,
  sum,
  zero,
} from '../money.js';

export interface BudgetPolicy {
  readonly asset: AssetCode;
  /** Hard ceiling for the whole workflow. */
  readonly workflowCap: Money;
  /** Optional ceiling for any single step. */
  readonly perStepCap?: Money;
  /** Optional rolling ceiling per UTC day, across all workflows in scope. */
  readonly dailyCap?: Money;
  /** Optional ceiling on total spend with one counterparty. */
  readonly perCounterpartyCap?: Money;
  /**
   * Spend at or above this amount pauses for a human decision.
   * Absent means no step is auto-approved on cost grounds alone.
   */
  readonly approvalThreshold?: Money;
}

export type ReservationStatus = 'reserved' | 'settled' | 'released';

export interface Reservation {
  readonly stepId: string;
  /** Guards against a retried tick reserving twice for the same attempt. */
  readonly idempotencyKey: string;
  readonly status: ReservationStatus;
  readonly reserved: Money;
  /** Zero until settled; may be less than `reserved` under the upto scheme. */
  readonly settled: Money;
  readonly counterpartyId: string | null;
  /** UTC day key the settlement landed on, for the daily cap. */
  readonly settledOn: string | null;
}

export interface BudgetState {
  readonly policy: BudgetPolicy;
  readonly reservations: ReadonlyMap<string, Reservation>;
}

export interface ReservationRequest {
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly amount: Money;
  readonly counterpartyId?: string;
}

export type DenialCode =
  | 'ASSET_MISMATCH'
  | 'NON_POSITIVE_AMOUNT'
  | 'WORKFLOW_CAP_EXCEEDED'
  | 'STEP_CAP_EXCEEDED'
  | 'DAILY_CAP_EXCEEDED'
  | 'COUNTERPARTY_CAP_EXCEEDED'
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'ALREADY_SETTLED'
  | 'NOT_RESERVED'
  | 'SETTLE_EXCEEDS_RESERVATION'
  | 'REFUND_EXCEEDS_SETTLEMENT';

export type BudgetDecision =
  | { readonly outcome: 'allow' }
  | { readonly outcome: 'requires_approval'; readonly reason: string }
  | { readonly outcome: 'deny'; readonly code: DenialCode; readonly reason: string };

export class BudgetError extends Error {
  readonly code: DenialCode;

  constructor(code: DenialCode, message: string) {
    super(message);
    this.name = 'BudgetError';
    this.code = code;
  }
}

/** Aggregate view of where the money stands. */
export interface BudgetExposure {
  /** Outstanding reservations that have not settled or been released. */
  readonly reserved: Money;
  /** Net settled spend, after refunds. */
  readonly settled: Money;
  /** reserved + settled — the amount the workflow has put at risk. */
  readonly committed: Money;
  /** workflowCap - committed. Never negative. */
  readonly available: Money;
}

export function createBudget(policy: BudgetPolicy): BudgetState {
  if (isNegative(policy.workflowCap) || isZero(policy.workflowCap)) {
    throw new BudgetError(
      'NON_POSITIVE_AMOUNT',
      `workflow cap must be positive, received ${formatMoney(policy.workflowCap)}`,
    );
  }
  for (const [name, cap] of [
    ['perStepCap', policy.perStepCap],
    ['dailyCap', policy.dailyCap],
    ['perCounterpartyCap', policy.perCounterpartyCap],
    ['approvalThreshold', policy.approvalThreshold],
  ] as const) {
    if (cap && cap.asset !== policy.asset) {
      throw new BudgetError(
        'ASSET_MISMATCH',
        `${name} is denominated in ${cap.asset} but the policy asset is ${policy.asset}`,
      );
    }
  }
  return { policy, reservations: new Map() };
}

function activeReservations(state: BudgetState): readonly Reservation[] {
  return [...state.reservations.values()].filter((r) => r.status === 'reserved');
}

function settledReservations(state: BudgetState): readonly Reservation[] {
  return [...state.reservations.values()].filter((r) => r.status === 'settled');
}

export function exposure(state: BudgetState): BudgetExposure {
  const asset = state.policy.asset;
  const reserved = sum(
    asset,
    activeReservations(state).map((r) => r.reserved),
  );
  const settled = sum(
    asset,
    settledReservations(state).map((r) => r.settled),
  );
  const committed = add(reserved, settled);
  const remaining = subtract(state.policy.workflowCap, committed);
  return {
    reserved,
    settled,
    committed,
    available: isNegative(remaining) ? zero(asset) : remaining,
  };
}

/** Net settled spend with one counterparty. */
export function settledWithCounterparty(state: BudgetState, counterpartyId: string): Money {
  return sum(
    state.policy.asset,
    [...state.reservations.values()]
      .filter((r) => r.counterpartyId === counterpartyId)
      .map((r) => (r.status === 'settled' ? r.settled : r.reserved)),
  );
}

/** Net settled spend on one UTC day. */
export function settledOnDay(state: BudgetState, day: string): Money {
  return sum(
    state.policy.asset,
    settledReservations(state)
      .filter((r) => r.settledOn === day)
      .map((r) => r.settled),
  );
}

/** UTC day key. Deliberately UTC so replay does not shift across timezones. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Decide a reservation without mutating anything.
 *
 * The approval gate is checked last and only when the spend is otherwise
 * allowed: there is no point asking a human to approve something the caps
 * already forbid.
 */
export function evaluateReservation(
  state: BudgetState,
  request: ReservationRequest,
  at: Date = new Date(),
): BudgetDecision {
  const { policy } = state;
  const { amount } = request;

  if (amount.asset !== policy.asset) {
    return {
      outcome: 'deny',
      code: 'ASSET_MISMATCH',
      reason: `step "${request.stepId}" spends ${amount.asset} but the budget is ${policy.asset}`,
    };
  }
  if (isNegative(amount) || isZero(amount)) {
    return {
      outcome: 'deny',
      code: 'NON_POSITIVE_AMOUNT',
      reason: `reservation for "${request.stepId}" must be positive, received ${formatMoney(amount)}`,
    };
  }

  const existing = state.reservations.get(request.stepId);
  if (existing && existing.idempotencyKey !== request.idempotencyKey) {
    return {
      outcome: 'deny',
      code: 'DUPLICATE_IDEMPOTENCY_KEY',
      reason:
        `step "${request.stepId}" already holds a reservation under a different ` +
        'idempotency key; a step may not reserve twice',
    };
  }

  if (policy.perStepCap && greaterThan(amount, policy.perStepCap)) {
    return {
      outcome: 'deny',
      code: 'STEP_CAP_EXCEEDED',
      reason:
        `${formatMoney(amount)} exceeds the per-step cap of ${formatMoney(policy.perStepCap)}`,
    };
  }

  // An idempotent replay must not be counted twice against the caps.
  const current = exposure(state);
  const alreadyHeld = existing && existing.status === 'reserved' ? existing.reserved : zero(policy.asset);
  const wouldCommit = add(subtract(current.committed, alreadyHeld), amount);

  if (greaterThan(wouldCommit, policy.workflowCap)) {
    return {
      outcome: 'deny',
      code: 'WORKFLOW_CAP_EXCEEDED',
      reason:
        `${formatMoney(amount)} would bring committed spend to ${formatMoney(wouldCommit)}, ` +
        `over the workflow cap of ${formatMoney(policy.workflowCap)}`,
    };
  }

  if (policy.dailyCap) {
    const today = add(settledOnDay(state, dayKey(at)), amount);
    if (greaterThan(today, policy.dailyCap)) {
      return {
        outcome: 'deny',
        code: 'DAILY_CAP_EXCEEDED',
        reason:
          `${formatMoney(amount)} would bring today's spend to ${formatMoney(today)}, ` +
          `over the daily cap of ${formatMoney(policy.dailyCap)}`,
      };
    }
  }

  if (policy.perCounterpartyCap && request.counterpartyId) {
    const withParty = add(
      settledWithCounterparty(state, request.counterpartyId),
      amount,
    );
    if (greaterThan(withParty, policy.perCounterpartyCap)) {
      return {
        outcome: 'deny',
        code: 'COUNTERPARTY_CAP_EXCEEDED',
        reason:
          `${formatMoney(amount)} would bring spend with "${request.counterpartyId}" to ` +
          `${formatMoney(withParty)}, over the per-counterparty cap of ` +
          formatMoney(policy.perCounterpartyCap),
      };
    }
  }

  if (policy.approvalThreshold && !greaterThan(policy.approvalThreshold, amount)) {
    return {
      outcome: 'requires_approval',
      reason:
        `${formatMoney(amount)} is at or above the approval threshold of ` +
        `${formatMoney(policy.approvalThreshold)}`,
    };
  }

  return { outcome: 'allow' };
}

/**
 * Earmark funds for a step.
 *
 * Replaying the same stepId with the same idempotency key is a no-op that
 * returns the existing state — a retried tick after a network blip must not
 * double-reserve. `requires_approval` is not a denial: the caller records
 * the gate and reserves once a human approves, so this function accepts it.
 */
export function reserve(
  state: BudgetState,
  request: ReservationRequest,
  at: Date = new Date(),
): BudgetState {
  const existing = state.reservations.get(request.stepId);
  if (existing && existing.idempotencyKey === request.idempotencyKey) {
    if (existing.status === 'reserved') return state;
    throw new BudgetError(
      'ALREADY_SETTLED',
      `step "${request.stepId}" is already ${existing.status} and cannot be reserved again`,
    );
  }

  const decision = evaluateReservation(state, request, at);
  if (decision.outcome === 'deny') {
    throw new BudgetError(decision.code, decision.reason);
  }

  const reservations = new Map(state.reservations);
  reservations.set(request.stepId, {
    stepId: request.stepId,
    idempotencyKey: request.idempotencyKey,
    status: 'reserved',
    reserved: request.amount,
    settled: zero(state.policy.asset),
    counterpartyId: request.counterpartyId ?? null,
    settledOn: null,
  });
  return { ...state, reservations };
}

/** Return an unused reservation to the available pool (quote expired, branch skipped). */
export function release(state: BudgetState, stepId: string): BudgetState {
  const existing = state.reservations.get(stepId);
  if (!existing) {
    throw new BudgetError('NOT_RESERVED', `step "${stepId}" holds no reservation to release`);
  }
  if (existing.status === 'released') return state;
  if (existing.status === 'settled') {
    throw new BudgetError(
      'ALREADY_SETTLED',
      `step "${stepId}" has settled and cannot be released; use refund instead`,
    );
  }
  const reservations = new Map(state.reservations);
  reservations.set(stepId, { ...existing, status: 'released' });
  return { ...state, reservations };
}

/**
 * Record the actual settled amount against a reservation.
 *
 * Settling below the reservation is normal under the `upto` scheme and the
 * difference is returned to the available pool. Settling *above* it is
 * refused: that is a provider raising its price after approval, and it must
 * surface as an error the orchestrator handles, not a silent overspend.
 */
export function settle(
  state: BudgetState,
  input: { readonly stepId: string; readonly amount: Money; readonly at?: Date },
): BudgetState {
  const existing = state.reservations.get(input.stepId);
  if (!existing) {
    throw new BudgetError(
      'NOT_RESERVED',
      `step "${input.stepId}" has no reservation to settle against`,
    );
  }
  if (existing.status === 'settled') {
    throw new BudgetError(
      'ALREADY_SETTLED',
      `step "${input.stepId}" has already settled ${formatMoney(existing.settled)}; ` +
        'a duplicate settlement was rejected',
    );
  }
  if (existing.status === 'released') {
    throw new BudgetError(
      'NOT_RESERVED',
      `step "${input.stepId}" was released and can no longer settle`,
    );
  }
  if (input.amount.asset !== state.policy.asset) {
    throw new BudgetError(
      'ASSET_MISMATCH',
      `settlement for "${input.stepId}" is in ${input.amount.asset}, expected ${state.policy.asset}`,
    );
  }
  if (isNegative(input.amount)) {
    throw new BudgetError(
      'NON_POSITIVE_AMOUNT',
      `settlement for "${input.stepId}" must not be negative`,
    );
  }
  if (greaterThan(input.amount, existing.reserved)) {
    throw new BudgetError(
      'SETTLE_EXCEEDS_RESERVATION',
      `step "${input.stepId}" tried to settle ${formatMoney(input.amount)} against a ` +
        `reservation of ${formatMoney(existing.reserved)}; the provider raised its price ` +
        'after authorisation and the excess is refused',
    );
  }

  const reservations = new Map(state.reservations);
  reservations.set(input.stepId, {
    ...existing,
    status: 'settled',
    settled: input.amount,
    settledOn: dayKey(input.at ?? new Date()),
  });
  return { ...state, reservations };
}

/**
 * Reduce a settled amount after a refund or partial compensation.
 *
 * Modelled as a reduction of the original settlement rather than a negative
 * entry, so `exposure` stays a simple sum and the ledger always shows net
 * position per step.
 */
export function refund(
  state: BudgetState,
  input: { readonly stepId: string; readonly amount: Money },
): BudgetState {
  const existing = state.reservations.get(input.stepId);
  if (!existing || existing.status !== 'settled') {
    throw new BudgetError(
      'NOT_RESERVED',
      `step "${input.stepId}" has no settlement to refund`,
    );
  }
  if (greaterThan(input.amount, existing.settled)) {
    throw new BudgetError(
      'REFUND_EXCEEDS_SETTLEMENT',
      `refund of ${formatMoney(input.amount)} exceeds the ${formatMoney(existing.settled)} ` +
        `settled by "${input.stepId}"`,
    );
  }
  const reservations = new Map(state.reservations);
  reservations.set(input.stepId, {
    ...existing,
    settled: subtract(existing.settled, input.amount),
  });
  return { ...state, reservations };
}
