import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount } from '../money.js';
import {
  BudgetError,
  type BudgetPolicy,
  createBudget,
  dayKey,
  evaluateReservation,
  exposure,
  refund,
  release,
  reserve,
  settle,
  settledOnDay,
  settledWithCounterparty,
} from './budget.js';

const usdc = (amount: string) => parseAmount('USDC', amount);

function policy(overrides: Partial<BudgetPolicy> = {}): BudgetPolicy {
  return { asset: 'USDC', workflowCap: usdc('1000'), ...overrides };
}

const JAN_01 = new Date('2026-01-01T10:00:00Z');
const JAN_02 = new Date('2026-01-02T10:00:00Z');

describe('createBudget', () => {
  it('rejects a non-positive workflow cap', () => {
    expect(() => createBudget(policy({ workflowCap: usdc('0') }))).toThrow(BudgetError);
  });

  it('rejects a cap denominated in a different asset', () => {
    expect(() =>
      createBudget(policy({ perStepCap: parseAmount('ALGO', '10') })),
    ).toThrow(BudgetError);
  });

  it('starts with nothing committed and the full cap available', () => {
    const state = createBudget(policy());
    expect(formatMoney(exposure(state).available)).toBe('1000.000000 USDC');
    expect(exposure(state).committed.units).toBe(0n);
  });
});

describe('reserve', () => {
  it('earmarks funds and reduces what is available', () => {
    const state = reserve(createBudget(policy()), {
      stepId: 'pay_supplier',
      idempotencyKey: 'k1',
      amount: usdc('300'),
    });
    const view = exposure(state);
    expect(formatMoney(view.reserved)).toBe('300.000000 USDC');
    expect(formatMoney(view.available)).toBe('700.000000 USDC');
  });

  it('is idempotent: a retried tick does not double-reserve', () => {
    // A tick that times out after writing but before acknowledging will retry.
    const request = { stepId: 'pay_supplier', idempotencyKey: 'k1', amount: usdc('300') };
    const once = reserve(createBudget(policy()), request);
    const twice = reserve(once, request);
    expect(formatMoney(exposure(twice).reserved)).toBe('300.000000 USDC');
    expect(twice).toBe(once);
  });

  it('refuses a second reservation for the same step under a new key', () => {
    const state = reserve(createBudget(policy()), {
      stepId: 'pay_supplier',
      idempotencyKey: 'k1',
      amount: usdc('300'),
    });
    expect(() =>
      reserve(state, { stepId: 'pay_supplier', idempotencyKey: 'k2', amount: usdc('50') }),
    ).toThrow(/different idempotency key/);
  });

  it('denies spend beyond the workflow cap', () => {
    const state = reserve(createBudget(policy()), {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('800'),
    });
    expect(() =>
      reserve(state, { stepId: 'b', idempotencyKey: 'k2', amount: usdc('300') }),
    ).toThrow(BudgetError);
  });

  it('allows spend exactly at the cap boundary', () => {
    const state = reserve(createBudget(policy()), {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('1000'),
    });
    expect(exposure(state).available.units).toBe(0n);
  });

  it('enforces the per-step cap', () => {
    const state = createBudget(policy({ perStepCap: usdc('100') }));
    expect(() =>
      reserve(state, { stepId: 'a', idempotencyKey: 'k1', amount: usdc('101') }),
    ).toThrow(/per-step cap/);
  });

  it('rejects a zero or negative reservation', () => {
    const state = createBudget(policy());
    expect(() =>
      reserve(state, { stepId: 'a', idempotencyKey: 'k1', amount: usdc('0') }),
    ).toThrow(BudgetError);
  });

  it('rejects a reservation in the wrong asset', () => {
    const state = createBudget(policy());
    expect(() =>
      reserve(state, { stepId: 'a', idempotencyKey: 'k1', amount: parseAmount('ALGO', '5') }),
    ).toThrow(BudgetError);
  });
});

describe('evaluateReservation — approval gate', () => {
  it('requires approval at or above the threshold', () => {
    const state = createBudget(policy({ approvalThreshold: usdc('250') }));
    const decision = evaluateReservation(state, {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('250'),
    });
    expect(decision.outcome).toBe('requires_approval');
  });

  it('auto-allows below the threshold', () => {
    const state = createBudget(policy({ approvalThreshold: usdc('250') }));
    const decision = evaluateReservation(state, {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('249.999999'),
    });
    expect(decision.outcome).toBe('allow');
  });

  it('denies rather than asking for approval when a cap already forbids it', () => {
    // No point pausing a human on something that cannot proceed either way.
    const state = createBudget(policy({ workflowCap: usdc('100'), approvalThreshold: usdc('10') }));
    const decision = evaluateReservation(state, {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('500'),
    });
    expect(decision).toMatchObject({ outcome: 'deny', code: 'WORKFLOW_CAP_EXCEEDED' });
  });

  it('does not mutate state', () => {
    const state = createBudget(policy());
    evaluateReservation(state, { stepId: 'a', idempotencyKey: 'k1', amount: usdc('10') });
    expect(state.reservations.size).toBe(0);
  });
});

describe('settle', () => {
  function reserved(amount = '300') {
    return reserve(createBudget(policy()), {
      stepId: 'pay_supplier',
      idempotencyKey: 'k1',
      amount: usdc(amount),
    });
  }

  it('records the settled amount and clears the reservation', () => {
    const state = settle(reserved(), { stepId: 'pay_supplier', amount: usdc('300'), at: JAN_01 });
    const view = exposure(state);
    expect(view.reserved.units).toBe(0n);
    expect(formatMoney(view.settled)).toBe('300.000000 USDC');
  });

  it('returns the unused remainder under the upto scheme', () => {
    // Authorised up to 300, metered usage came to 180.
    const state = settle(reserved(), { stepId: 'pay_supplier', amount: usdc('180'), at: JAN_01 });
    expect(formatMoney(exposure(state).available)).toBe('820.000000 USDC');
  });

  it('refuses to settle more than was reserved when a provider raises its price', () => {
    // Hard-mode case: the provider changes its offer after human approval.
    expect(() =>
      settle(reserved(), { stepId: 'pay_supplier', amount: usdc('310'), at: JAN_01 }),
    ).toThrow(/raised its price after authorisation/);
  });

  it('rejects a duplicate settlement', () => {
    const once = settle(reserved(), { stepId: 'pay_supplier', amount: usdc('300'), at: JAN_01 });
    expect(() =>
      settle(once, { stepId: 'pay_supplier', amount: usdc('300'), at: JAN_01 }),
    ).toThrow(/duplicate settlement was rejected/);
  });

  it('refuses to settle a step that never reserved', () => {
    expect(() =>
      settle(createBudget(policy()), { stepId: 'ghost', amount: usdc('1'), at: JAN_01 }),
    ).toThrow(BudgetError);
  });

  it('refuses to settle a released reservation', () => {
    const released = release(reserved(), 'pay_supplier');
    expect(() =>
      settle(released, { stepId: 'pay_supplier', amount: usdc('300'), at: JAN_01 }),
    ).toThrow(BudgetError);
  });

  it('allows a zero settlement when a provider delivered free of charge', () => {
    const state = settle(reserved(), { stepId: 'pay_supplier', amount: usdc('0'), at: JAN_01 });
    expect(exposure(state).settled.units).toBe(0n);
  });
});

describe('release', () => {
  it('returns an unused reservation to the pool when a branch is skipped', () => {
    const state = release(
      reserve(createBudget(policy()), {
        stepId: 'pay_inspection',
        idempotencyKey: 'k1',
        amount: usdc('40'),
      }),
      'pay_inspection',
    );
    expect(formatMoney(exposure(state).available)).toBe('1000.000000 USDC');
  });

  it('is idempotent', () => {
    const once = release(
      reserve(createBudget(policy()), { stepId: 'a', idempotencyKey: 'k1', amount: usdc('40') }),
      'a',
    );
    expect(release(once, 'a')).toBe(once);
  });

  it('refuses to release a settled step', () => {
    const settled = settle(
      reserve(createBudget(policy()), { stepId: 'a', idempotencyKey: 'k1', amount: usdc('40') }),
      { stepId: 'a', amount: usdc('40'), at: JAN_01 },
    );
    expect(() => release(settled, 'a')).toThrow(/use refund instead/);
  });

  it('refuses to release an unknown step', () => {
    expect(() => release(createBudget(policy()), 'ghost')).toThrow(BudgetError);
  });
});

describe('refund — partial compensation', () => {
  function settled() {
    return settle(
      reserve(createBudget(policy()), {
        stepId: 'pay_supplier',
        idempotencyKey: 'k1',
        amount: usdc('300'),
      }),
      { stepId: 'pay_supplier', amount: usdc('300'), at: JAN_01 },
    );
  }

  it('reduces net settled spend', () => {
    const state = refund(settled(), { stepId: 'pay_supplier', amount: usdc('120') });
    expect(formatMoney(exposure(state).settled)).toBe('180.000000 USDC');
  });

  it('frees the refunded amount for reuse', () => {
    const state = refund(settled(), { stepId: 'pay_supplier', amount: usdc('300') });
    expect(formatMoney(exposure(state).available)).toBe('1000.000000 USDC');
  });

  it('refuses to refund more than was settled', () => {
    expect(() => refund(settled(), { stepId: 'pay_supplier', amount: usdc('301') })).toThrow(
      BudgetError,
    );
  });

  it('refuses to refund a step that never settled', () => {
    const open = reserve(createBudget(policy()), {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('40'),
    });
    expect(() => refund(open, { stepId: 'a', amount: usdc('10') })).toThrow(BudgetError);
  });
});

describe('daily cap', () => {
  it('denies spend that would breach the cap for that UTC day', () => {
    let state = createBudget(policy({ dailyCap: usdc('100') }));
    state = reserve(state, { stepId: 'a', idempotencyKey: 'k1', amount: usdc('80') }, JAN_01);
    state = settle(state, { stepId: 'a', amount: usdc('80'), at: JAN_01 });
    expect(() =>
      reserve(state, { stepId: 'b', idempotencyKey: 'k2', amount: usdc('30') }, JAN_01),
    ).toThrow(/daily cap/);
  });

  it('resets on the next UTC day', () => {
    let state = createBudget(policy({ dailyCap: usdc('100') }));
    state = reserve(state, { stepId: 'a', idempotencyKey: 'k1', amount: usdc('80') }, JAN_01);
    state = settle(state, { stepId: 'a', amount: usdc('80'), at: JAN_01 });
    expect(() =>
      reserve(state, { stepId: 'b', idempotencyKey: 'k2', amount: usdc('30') }, JAN_02),
    ).not.toThrow();
  });

  it('attributes settlement to the day it landed', () => {
    let state = createBudget(policy({ dailyCap: usdc('100') }));
    state = reserve(state, { stepId: 'a', idempotencyKey: 'k1', amount: usdc('80') }, JAN_01);
    state = settle(state, { stepId: 'a', amount: usdc('80'), at: JAN_01 });
    expect(formatMoney(settledOnDay(state, dayKey(JAN_01)))).toBe('80.000000 USDC');
    expect(settledOnDay(state, dayKey(JAN_02)).units).toBe(0n);
  });
});

describe('per-counterparty cap', () => {
  it('limits total exposure to one counterparty', () => {
    let state = createBudget(policy({ perCounterpartyCap: usdc('200') }));
    state = reserve(state, {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('150'),
      counterpartyId: 'tenant_b',
    });
    expect(() =>
      reserve(state, {
        stepId: 'b',
        idempotencyKey: 'k2',
        amount: usdc('100'),
        counterpartyId: 'tenant_b',
      }),
    ).toThrow(/per-counterparty cap/);
  });

  it('tracks counterparties independently', () => {
    let state = createBudget(policy({ perCounterpartyCap: usdc('200') }));
    state = reserve(state, {
      stepId: 'a',
      idempotencyKey: 'k1',
      amount: usdc('150'),
      counterpartyId: 'tenant_b',
    });
    expect(() =>
      reserve(state, {
        stepId: 'b',
        idempotencyKey: 'k2',
        amount: usdc('150'),
        counterpartyId: 'tenant_c',
      }),
    ).not.toThrow();
    expect(formatMoney(settledWithCounterparty(state, 'tenant_b'))).toBe('150.000000 USDC');
  });
});

describe('the demo spend sequence end to end', () => {
  it('tracks reserve, partial settle, cancel and refund to a correct closing position', () => {
    // Mirrors the handbook demo: pay one step, cancel, show the ledger close.
    let state = createBudget(policy({ workflowCap: usdc('500'), approvalThreshold: usdc('250') }));

    // Supplier payment needs approval at 300.
    expect(
      evaluateReservation(state, {
        stepId: 'pay_supplier',
        idempotencyKey: 'k1',
        amount: usdc('300'),
      }).outcome,
    ).toBe('requires_approval');

    // Human approves; reserve then settle at the metered amount.
    state = reserve(state, { stepId: 'pay_supplier', idempotencyKey: 'k1', amount: usdc('300') });
    state = settle(state, { stepId: 'pay_supplier', amount: usdc('280'), at: JAN_01 });

    // Inspection branch was reserved, then skipped on a quality condition.
    state = reserve(state, {
      stepId: 'pay_inspection',
      idempotencyKey: 'k2',
      amount: usdc('40'),
    });
    state = release(state, 'pay_inspection');

    // Workflow cancelled after delivery failed; supplier refunds half.
    state = refund(state, { stepId: 'pay_supplier', amount: usdc('140') });

    const view = exposure(state);
    expect(formatMoney(view.settled)).toBe('140.000000 USDC');
    expect(view.reserved.units).toBe(0n);
    expect(formatMoney(view.available)).toBe('360.000000 USDC');
  });
});
