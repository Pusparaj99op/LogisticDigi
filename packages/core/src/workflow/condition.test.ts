import { describe, expect, it } from 'vitest';
import { parseAmount } from '../money.js';
import {
  ALWAYS,
  collectRefs,
  type Condition,
  ConditionError,
  describeCondition,
  evaluateCondition,
  NEVER,
  resolveRef,
} from './condition.js';

/** Mirrors the shape the step runner records after each agent turn. */
const context = {
  steps: {
    quote_freight: {
      output: {
        price: parseAmount('USDC', '42.50'),
        carrier: 'MaerskSim',
        etaDays: 6,
        qualityScore: 0.91,
        insured: true,
        note: null,
      },
    },
    inspect_goods: {
      output: {
        defectRate: 0.02,
      },
    },
  },
  budget: {
    remaining: parseAmount('USDC', '500'),
  },
};

describe('resolveRef', () => {
  it('walks a dotted path', () => {
    expect(resolveRef(context, 'steps.quote_freight.output.carrier').resolved).toBe('MaerskSim');
  });

  it('reports a missing leaf as not found rather than throwing', () => {
    const resolution = resolveRef(context, 'steps.quote_freight.output.missing');
    expect(resolution.found).toBe(false);
    expect(resolution.resolved).toBeUndefined();
  });

  it('reports a missing intermediate step as not found', () => {
    expect(resolveRef(context, 'steps.never_ran.output.price').found).toBe(false);
  });

  it('treats an explicit null as present but not found', () => {
    // `note` is null: the path exists, but there is no value to compare.
    expect(resolveRef(context, 'steps.quote_freight.output.note').found).toBe(false);
  });

  it('does not descend through a primitive', () => {
    expect(resolveRef(context, 'steps.quote_freight.output.carrier.length').found).toBe(false);
  });

  it('refuses to traverse the prototype chain', () => {
    // Conditions can be derived from untrusted counterparty text.
    expect(() => resolveRef(context, 'steps.__proto__.polluted')).toThrow(ConditionError);
    expect(() => resolveRef(context, 'constructor.name')).toThrow(ConditionError);
  });

  it('does not resolve inherited properties', () => {
    expect(resolveRef(context, 'steps.quote_freight.output.toString').found).toBe(false);
  });

  it('rejects an empty path', () => {
    expect(() => resolveRef(context, '')).toThrow(ConditionError);
  });
});

describe('literal conditions', () => {
  it('evaluates always and never', () => {
    expect(evaluateCondition(ALWAYS, context).value).toBe(true);
    expect(evaluateCondition(NEVER, context).value).toBe(false);
  });
});

describe('equality', () => {
  it('compares strings', () => {
    const condition: Condition = {
      op: 'eq',
      ref: 'steps.quote_freight.output.carrier',
      value: 'MaerskSim',
    };
    expect(evaluateCondition(condition, context).value).toBe(true);
  });

  it('compares booleans', () => {
    const condition: Condition = {
      op: 'eq',
      ref: 'steps.quote_freight.output.insured',
      value: true,
    };
    expect(evaluateCondition(condition, context).value).toBe(true);
  });

  it('negates with neq', () => {
    const condition: Condition = {
      op: 'neq',
      ref: 'steps.quote_freight.output.carrier',
      value: 'OtherCarrier',
    };
    expect(evaluateCondition(condition, context).value).toBe(true);
  });

  it('compares Money by value, not by object identity', () => {
    const condition: Condition = {
      op: 'eq',
      ref: 'steps.quote_freight.output.price',
      value: 42.5,
    };
    expect(evaluateCondition(condition, context).value).toBe(true);
  });

  it('is false rather than throwing when the ref is missing', () => {
    const condition: Condition = { op: 'eq', ref: 'steps.absent.output.x', value: 1 };
    expect(evaluateCondition(condition, context).value).toBe(false);
  });
});

describe('ordered comparison', () => {
  it('compares a plain number against a threshold', () => {
    const condition: Condition = {
      op: 'lte',
      ref: 'steps.quote_freight.output.etaDays',
      value: 7,
    };
    expect(evaluateCondition(condition, context).value).toBe(true);
  });

  it('compares Money against a whole-unit threshold', () => {
    // 42.50 USDC is under a 50 USDC approval threshold.
    const under: Condition = { op: 'lt', ref: 'steps.quote_freight.output.price', value: 50 };
    const over: Condition = { op: 'gt', ref: 'steps.quote_freight.output.price', value: 50 };
    expect(evaluateCondition(under, context).value).toBe(true);
    expect(evaluateCondition(over, context).value).toBe(false);
  });

  it('is inclusive at the boundary for gte and lte', () => {
    const local = { value: 10 };
    expect(evaluateCondition({ op: 'gte', ref: 'value', value: 10 }, local).value).toBe(true);
    expect(evaluateCondition({ op: 'lte', ref: 'value', value: 10 }, local).value).toBe(true);
    expect(evaluateCondition({ op: 'gt', ref: 'value', value: 10 }, local).value).toBe(false);
  });

  it('throws on a missing ref instead of silently skipping a branch', () => {
    // Silently treating "missing" as false would skip a payment guard.
    const condition: Condition = { op: 'gt', ref: 'steps.absent.output.price', value: 1 };
    expect(() => evaluateCondition(condition, context)).toThrow(ConditionError);
  });

  it('refuses to order a string', () => {
    const condition: Condition = {
      op: 'gt',
      ref: 'steps.quote_freight.output.carrier',
      value: 1,
    };
    expect(() => evaluateCondition(condition, context)).toThrow(ConditionError);
  });
});

describe('boolean composition', () => {
  const cheapEnough: Condition = {
    op: 'lt',
    ref: 'steps.quote_freight.output.price',
    value: 50,
  };
  const fastEnough: Condition = {
    op: 'lte',
    ref: 'steps.quote_freight.output.etaDays',
    value: 7,
  };

  it('evaluates and', () => {
    expect(evaluateCondition({ op: 'and', of: [cheapEnough, fastEnough] }, context).value).toBe(
      true,
    );
  });

  it('evaluates or', () => {
    expect(evaluateCondition({ op: 'or', of: [NEVER, fastEnough] }, context).value).toBe(true);
  });

  it('evaluates not', () => {
    expect(evaluateCondition({ op: 'not', of: cheapEnough }, context).value).toBe(false);
  });

  it('rejects an empty operand list', () => {
    expect(() => evaluateCondition({ op: 'and', of: [] }, context)).toThrow(ConditionError);
    expect(() => evaluateCondition({ op: 'or', of: [] }, context)).toThrow(ConditionError);
  });

  it('short-circuits or, recording only what it actually consulted', () => {
    const result = evaluateCondition({ op: 'or', of: [cheapEnough, fastEnough] }, context);
    expect(result.value).toBe(true);
    expect(result.resolutions.map((r) => r.ref)).toEqual(['steps.quote_freight.output.price']);
  });

  it('short-circuits and on the first false operand', () => {
    const result = evaluateCondition({ op: 'and', of: [NEVER, fastEnough] }, context);
    expect(result.value).toBe(false);
    expect(result.resolutions).toEqual([]);
  });
});

describe('the skip-verification branch from the demo scenario', () => {
  // "Skip the paid inspection when the defect rate is already acceptable."
  const needsInspection: Condition = {
    op: 'and',
    of: [
      { op: 'exists', ref: 'steps.inspect_goods.output.defectRate' },
      { op: 'gt', ref: 'steps.inspect_goods.output.defectRate', value: 0.05 },
    ],
  };

  it('skips the paid branch when quality is already met', () => {
    expect(evaluateCondition(needsInspection, context).value).toBe(false);
  });

  it('takes the paid branch when quality fails', () => {
    const failing = { steps: { inspect_goods: { output: { defectRate: 0.11 } } } };
    expect(evaluateCondition(needsInspection, failing).value).toBe(true);
  });

  it('guards the ordered comparison so a missing output cannot throw', () => {
    const notRun = { steps: {} };
    expect(evaluateCondition(needsInspection, notRun).value).toBe(false);
  });

  it('is deterministic across repeated evaluation', () => {
    const first = evaluateCondition(needsInspection, context);
    const second = evaluateCondition(needsInspection, context);
    expect(first).toEqual(second);
  });
});

describe('collectRefs', () => {
  it('gathers every reference for compile-time validation', () => {
    const condition: Condition = {
      op: 'and',
      of: [
        { op: 'exists', ref: 'a' },
        { op: 'not', of: { op: 'or', of: [{ op: 'gt', ref: 'b', value: 1 }, ALWAYS] } },
      ],
    };
    expect(collectRefs(condition)).toEqual(['a', 'b']);
  });
});

describe('describeCondition', () => {
  it('renders a composite condition readably for the approval UI', () => {
    const condition: Condition = {
      op: 'and',
      of: [
        { op: 'lt', ref: 'price', value: 50 },
        { op: 'not', of: { op: 'eq', ref: 'carrier', value: 'Blocked' } },
      ],
    };
    expect(describeCondition(condition)).toBe('(price < 50 and not carrier == "Blocked")');
  });
});
