import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount } from '../money.js';
import {
  compileWorkflow,
  descendantsOf,
  readySteps,
  type StepStatus,
  unreachableSteps,
  type WorkflowSpec,
  type WorkflowStepSpec,
  WorkflowCompileError,
} from './graph.js';

const usdc = (amount: string) => parseAmount('USDC', amount);

function step(overrides: Partial<WorkflowStepSpec> & { id: string }): WorkflowStepSpec {
  return {
    kind: 'discover',
    role: 'procurement',
    description: `step ${overrides.id}`,
    ...overrides,
  };
}

function spec(steps: readonly WorkflowStepSpec[], budget = usdc('500')): WorkflowSpec {
  return {
    id: 'wf_test',
    tenantId: 'tenant_a',
    goal: 'restock chilled cargo',
    budget,
    steps,
  };
}

/**
 * The handbook's minimum viable demonstration: a three-provider workflow
 * with one branch that is skipped when a quality condition is already met.
 */
function demoWorkflow(): WorkflowSpec {
  return spec([
    step({ id: 'discover_suppliers', kind: 'discover', role: 'procurement' }),
    step({
      id: 'quote_supplier',
      kind: 'quote',
      role: 'procurement',
      dependsOn: ['discover_suppliers'],
    }),
    step({
      id: 'quote_freight',
      kind: 'quote',
      role: 'logistics',
      dependsOn: ['discover_suppliers'],
    }),
    step({
      id: 'negotiate_terms',
      kind: 'negotiate',
      role: 'negotiation',
      dependsOn: ['quote_supplier', 'quote_freight'],
    }),
    step({
      id: 'approve_spend',
      kind: 'approve',
      role: 'compliance',
      dependsOn: ['negotiate_terms'],
      requiresApproval: true,
    }),
    step({
      id: 'pay_supplier',
      kind: 'pay',
      role: 'settlement',
      dependsOn: ['approve_spend'],
      maxSpend: usdc('300'),
    }),
    // The conditional branch: a paid third-party inspection, skipped when
    // the supplier's own quality metadata already clears the threshold.
    step({
      id: 'pay_inspection',
      kind: 'pay',
      role: 'settlement',
      dependsOn: ['pay_supplier'],
      maxSpend: usdc('40'),
      when: {
        op: 'and',
        of: [
          { op: 'exists', ref: 'steps.negotiate_terms.output.qualityScore' },
          { op: 'lt', ref: 'steps.negotiate_terms.output.qualityScore', value: 0.9 },
        ],
      },
    }),
    step({
      id: 'verify_delivery',
      kind: 'verify',
      role: 'compliance',
      dependsOn: ['pay_supplier'],
    }),
    step({
      id: 'refund_supplier',
      kind: 'compensate',
      role: 'settlement',
      dependsOn: ['verify_delivery'],
      compensates: 'pay_supplier',
      maxSpend: usdc('300'),
    }),
  ]);
}

describe('compileWorkflow — structure', () => {
  it('compiles the demo workflow', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(workflow.steps.size).toBe(9);
  });

  it('orders every step after its prerequisites', () => {
    const workflow = compileWorkflow(demoWorkflow());
    for (const [id, compiled] of workflow.steps) {
      const index = workflow.order.indexOf(id);
      for (const dependency of compiled.dependsOn) {
        expect(workflow.order.indexOf(dependency)).toBeLessThan(index);
      }
    }
  });

  it('produces a byte-identical order on recompilation, so replay is stable', () => {
    expect(compileWorkflow(demoWorkflow()).order).toEqual(compileWorkflow(demoWorkflow()).order);
  });

  it('groups the two independent quotes into one parallel level', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(workflow.levels[0]).toEqual(['discover_suppliers']);
    expect(workflow.levels[1]).toEqual(['quote_supplier', 'quote_freight']);
  });

  it('records direct dependents', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(workflow.steps.get('discover_suppliers')?.dependents).toEqual([
      'quote_freight',
      'quote_supplier',
    ]);
  });

  it('computes the transitive ancestor closure', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(workflow.steps.get('pay_supplier')?.ancestors).toContain('discover_suppliers');
    expect(workflow.steps.get('quote_freight')?.ancestors).not.toContain('quote_supplier');
  });

  it('indexes approval gates and spending steps', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(workflow.approvalGates).toEqual(['approve_spend']);
    expect(workflow.spendingSteps).toEqual(['pay_supplier', 'pay_inspection', 'refund_supplier']);
  });

  it('sums worst-case spend across pay steps only, excluding compensation', () => {
    // 300 supplier + 40 inspection; the 300 refund returns funds.
    const workflow = compileWorkflow(demoWorkflow());
    expect(formatMoney(workflow.maxTheoreticalSpend)).toBe('340.000000 USDC');
  });
});

describe('compileWorkflow — rejects unsound graphs', () => {
  function issuesOf(input: WorkflowSpec): readonly string[] {
    try {
      compileWorkflow(input);
      throw new Error('expected compilation to fail');
    } catch (error) {
      if (!(error instanceof WorkflowCompileError)) throw error;
      return error.issues.map((issue) => issue.code);
    }
  }

  it('rejects an empty workflow', () => {
    expect(issuesOf(spec([]))).toContain('EMPTY_WORKFLOW');
  });

  it('rejects a zero or negative budget', () => {
    expect(issuesOf(spec([step({ id: 'a' })], usdc('0')))).toContain('INVALID_BUDGET');
  });

  it('rejects a duplicate step id', () => {
    expect(issuesOf(spec([step({ id: 'a' }), step({ id: 'a' })]))).toContain('DUPLICATE_STEP_ID');
  });

  it('rejects an id that would break condition reference parsing', () => {
    expect(issuesOf(spec([step({ id: 'Bad-Id' })]))).toContain('INVALID_STEP_ID');
  });

  it('rejects a dependency on an undeclared step', () => {
    expect(issuesOf(spec([step({ id: 'a', dependsOn: ['ghost'] })]))).toContain(
      'UNKNOWN_DEPENDENCY',
    );
  });

  it('rejects self-dependency', () => {
    expect(issuesOf(spec([step({ id: 'a', dependsOn: ['a'] })]))).toContain('SELF_DEPENDENCY');
  });

  it('rejects a cycle and names the path', () => {
    const cyclic = spec([
      step({ id: 'a', dependsOn: ['c'] }),
      step({ id: 'b', dependsOn: ['a'] }),
      step({ id: 'c', dependsOn: ['b'] }),
    ]);
    try {
      compileWorkflow(cyclic);
      throw new Error('expected compilation to fail');
    } catch (error) {
      if (!(error instanceof WorkflowCompileError)) throw error;
      expect(error.issues[0]?.code).toBe('CYCLE');
      expect(error.issues[0]?.message).toMatch(/->/);
    }
  });

  it('refuses an uncapped pay step', () => {
    // An uncapped money-moving step is the single most dangerous defect here.
    expect(issuesOf(spec([step({ id: 'p', kind: 'pay', role: 'settlement' })]))).toContain(
      'MISSING_SPEND_CAP',
    );
  });

  it('refuses a pay step denominated in a different asset from the budget', () => {
    const mismatched = spec([
      step({ id: 'p', kind: 'pay', role: 'settlement', maxSpend: parseAmount('ALGO', '10') }),
    ]);
    expect(issuesOf(mismatched)).toContain('ASSET_MISMATCH');
  });

  it('refuses a spend cap on a step that does not move funds', () => {
    expect(issuesOf(spec([step({ id: 'q', kind: 'quote', maxSpend: usdc('10') })]))).toContain(
      'UNEXPECTED_SPEND_CAP',
    );
  });

  it('refuses compensation of a non-pay step', () => {
    const bad = spec([
      step({ id: 'q', kind: 'quote' }),
      step({
        id: 'c',
        kind: 'compensate',
        role: 'settlement',
        compensates: 'q',
        maxSpend: usdc('10'),
      }),
    ]);
    expect(issuesOf(bad)).toContain('INVALID_COMPENSATION_TARGET');
  });

  it('refuses a compensate step with no target', () => {
    const bad = spec([
      step({ id: 'c', kind: 'compensate', role: 'settlement', maxSpend: usdc('10') }),
    ]);
    expect(issuesOf(bad)).toContain('MISSING_COMPENSATION_TARGET');
  });

  it('refuses a blank description, which would leave an approval gate unexplained', () => {
    expect(issuesOf(spec([step({ id: 'a', description: '   ' })]))).toContain(
      'MISSING_DESCRIPTION',
    );
  });

  it('collects every issue rather than stopping at the first', () => {
    const messy = spec([
      step({ id: 'a', dependsOn: ['ghost'] }),
      step({ id: 'p', kind: 'pay', role: 'settlement' }),
      step({ id: 'a' }),
    ]);
    const codes = issuesOf(messy);
    expect(codes).toContain('UNKNOWN_DEPENDENCY');
    expect(codes).toContain('MISSING_SPEND_CAP');
    expect(codes).toContain('DUPLICATE_STEP_ID');
  });
});

describe('compileWorkflow — condition references', () => {
  it('rejects a condition referencing an undeclared step', () => {
    const bad = spec([
      step({ id: 'a' }),
      step({
        id: 'b',
        dependsOn: ['a'],
        when: { op: 'exists', ref: 'steps.ghost.output.x' },
      }),
    ]);
    expect(() => compileWorkflow(bad)).toThrow(WorkflowCompileError);
  });

  it('rejects reading a step that is not a prerequisite, which would race', () => {
    // `b` and `c` are siblings; b reading c's output is nondeterministic and
    // would make replay meaningless.
    const racy = spec([
      step({ id: 'a' }),
      step({ id: 'c', dependsOn: ['a'] }),
      step({
        id: 'b',
        dependsOn: ['a'],
        when: { op: 'exists', ref: 'steps.c.output.x' },
      }),
    ]);
    try {
      compileWorkflow(racy);
      throw new Error('expected compilation to fail');
    } catch (error) {
      if (!(error instanceof WorkflowCompileError)) throw error;
      expect(error.issues.map((i) => i.code)).toContain('CONDITION_REF_NOT_ANCESTOR');
    }
  });

  it('accepts reading a transitive ancestor, not just a direct dependency', () => {
    const workflow = compileWorkflow(demoWorkflow());
    // pay_inspection reads negotiate_terms, two levels up. This must compile.
    expect(workflow.steps.get('pay_inspection')?.when).toBeDefined();
  });

  it('ignores non-step references that are resolved at runtime', () => {
    const runtimeRef = spec([
      step({ id: 'a', when: { op: 'gt', ref: 'budget.remaining', value: 10 } }),
    ]);
    expect(() => compileWorkflow(runtimeRef)).not.toThrow();
  });
});

describe('readySteps', () => {
  it('starts with the root step only', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(readySteps(workflow, new Map())).toEqual(['discover_suppliers']);
  });

  it('releases both parallel quotes once discovery succeeds', () => {
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([['discover_suppliers', 'succeeded']]);
    expect(readySteps(workflow, statuses)).toEqual(['quote_supplier', 'quote_freight']);
  });

  it('waits for every prerequisite, not just one', () => {
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([
      ['discover_suppliers', 'succeeded'],
      ['quote_supplier', 'succeeded'],
    ]);
    expect(readySteps(workflow, statuses)).toEqual(['quote_freight']);
  });

  it('treats a skipped prerequisite as satisfied so the main line continues', () => {
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([
      ['discover_suppliers', 'succeeded'],
      ['quote_supplier', 'skipped'],
      ['quote_freight', 'succeeded'],
    ]);
    expect(readySteps(workflow, statuses)).toContain('negotiate_terms');
  });

  it('does not release a step whose prerequisite failed', () => {
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([
      ['discover_suppliers', 'succeeded'],
      ['quote_supplier', 'failed'],
      ['quote_freight', 'succeeded'],
    ]);
    expect(readySteps(workflow, statuses)).not.toContain('negotiate_terms');
  });

  it('never re-releases a running step, which would double-execute a payment', () => {
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([['discover_suppliers', 'running']]);
    expect(readySteps(workflow, statuses)).toEqual([]);
  });

  it('does not release a step awaiting human approval', () => {
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([['discover_suppliers', 'awaiting_approval']]);
    expect(readySteps(workflow, statuses)).toEqual([]);
  });
});

describe('unreachableSteps — closing a cancelled workflow', () => {
  it('reports the whole downstream branch when a step is cancelled', () => {
    // The handbook: cancel after one paid step, then show what is not purchased.
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([
      ['discover_suppliers', 'succeeded'],
      ['quote_supplier', 'succeeded'],
      ['quote_freight', 'succeeded'],
      ['negotiate_terms', 'succeeded'],
      ['approve_spend', 'succeeded'],
      ['pay_supplier', 'succeeded'],
      ['verify_delivery', 'cancelled'],
    ]);
    expect(unreachableSteps(workflow, statuses)).toEqual(['refund_supplier']);
  });

  it('does not report already-resolved steps', () => {
    const workflow = compileWorkflow(demoWorkflow());
    const statuses = new Map<string, StepStatus>([['discover_suppliers', 'failed']]);
    expect(unreachableSteps(workflow, statuses)).not.toContain('discover_suppliers');
  });

  it('reports nothing while the workflow is healthy', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(unreachableSteps(workflow, new Map())).toEqual([]);
  });
});

describe('descendantsOf', () => {
  it('lists every transitive descendant in topological order', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(descendantsOf(workflow, 'pay_supplier')).toEqual([
      'pay_inspection',
      'verify_delivery',
      'refund_supplier',
    ]);
  });

  it('returns nothing for a leaf', () => {
    const workflow = compileWorkflow(demoWorkflow());
    expect(descendantsOf(workflow, 'refund_supplier')).toEqual([]);
  });
});
