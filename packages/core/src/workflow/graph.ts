/**
 * Workflow graph: specification, validation, and compilation.
 *
 * A goal ("restock 400 pallets of chilled cargo from the cheapest compliant
 * supplier and get it to Rotterdam by Friday") is turned into a directed
 * acyclic graph of steps with prerequisites, parallel branches, conditional
 * edges, human-approval gates, and compensation semantics.
 *
 * The compiler is strict on purpose. A malformed workflow must fail here, at
 * compile time, with a precise message — not halfway through execution after
 * a payment has already settled. Every failure this module catches is a
 * failure that would otherwise cost real money on-chain.
 */

import { formatMoney, isNegative, isZero, type Money } from '../money.js';
import { type Condition, collectRefs, describeCondition } from './condition.js';

/** Which specialist sub-agent executes a step. Determines the tool scope. */
export type AgentRole =
  | 'inventory'
  | 'procurement'
  | 'negotiation'
  | 'compliance'
  | 'settlement'
  | 'logistics';

export const AGENT_ROLES: readonly AgentRole[] = [
  'inventory',
  'procurement',
  'negotiation',
  'compliance',
  'settlement',
  'logistics',
];

/** What a step does. `pay` and `compensate` are the money-moving kinds. */
export type StepKind =
  | 'discover'
  | 'quote'
  | 'negotiate'
  | 'approve'
  | 'pay'
  | 'verify'
  | 'fulfill'
  | 'track'
  | 'compensate';

export const STEP_KINDS: readonly StepKind[] = [
  'discover',
  'quote',
  'negotiate',
  'approve',
  'pay',
  'verify',
  'fulfill',
  'track',
  'compensate',
];

/** Step kinds that move funds and therefore require a spend ceiling. */
const SPENDING_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(['pay', 'compensate']);

export interface WorkflowStepSpec {
  readonly id: string;
  readonly kind: StepKind;
  readonly role: AgentRole;
  /** Human-readable purpose, surfaced in the trace and approval UI. */
  readonly description: string;
  /** Step ids that must resolve before this one becomes ready. */
  readonly dependsOn?: readonly string[];
  /** Conditional edge: when false, this step and its descendants are skipped. */
  readonly when?: Condition;
  /** Pause for a human decision before executing. */
  readonly requiresApproval?: boolean;
  /** Ceiling for a money-moving step. Enforced by the budget engine. */
  readonly maxSpend?: Money;
  /** For `compensate` steps: the `pay` step this one reverses. */
  readonly compensates?: string;
}

export interface WorkflowSpec {
  readonly id: string;
  readonly tenantId: string;
  readonly goal: string;
  readonly budget: Money;
  readonly steps: readonly WorkflowStepSpec[];
}

export interface CompiledStep extends WorkflowStepSpec {
  readonly dependsOn: readonly string[];
  /** Steps that depend directly on this one. */
  readonly dependents: readonly string[];
  /** Every transitive prerequisite. Used to validate condition references. */
  readonly ancestors: ReadonlySet<string>;
  /** 0 for roots; otherwise one more than the deepest prerequisite. */
  readonly depth: number;
}

export interface CompiledWorkflow {
  readonly id: string;
  readonly tenantId: string;
  readonly goal: string;
  readonly budget: Money;
  readonly steps: ReadonlyMap<string, CompiledStep>;
  /** Deterministic topological order. Stable across compilations. */
  readonly order: readonly string[];
  /** Steps grouped by depth — each group may run in parallel. */
  readonly levels: readonly (readonly string[])[];
  /** Steps that require a human decision, in topological order. */
  readonly approvalGates: readonly string[];
  /** Money-moving steps, in topological order. */
  readonly spendingSteps: readonly string[];
  /** Worst-case spend if every conditional branch is taken. */
  readonly maxTheoreticalSpend: Money;
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly stepId?: string;
}

export class WorkflowCompileError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const detail = issues.map((issue) => `  - [${issue.code}] ${issue.message}`).join('\n');
    super(`workflow failed to compile with ${issues.length} issue(s):\n${detail}`);
    this.name = 'WorkflowCompileError';
    this.issues = issues;
  }
}

const STEP_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Matches a condition reference into a step output: steps.<id>.output.<path> */
const STEP_REF_PATTERN = /^steps\.([a-z][a-z0-9_]*)\./;

/**
 * Compile and validate a workflow specification.
 *
 * Collects every issue before throwing rather than failing on the first, so
 * an author fixing a generated plan sees the whole picture at once.
 */
export function compileWorkflow(spec: WorkflowSpec): CompiledWorkflow {
  const issues: ValidationIssue[] = [];

  if (spec.steps.length === 0) {
    issues.push({ code: 'EMPTY_WORKFLOW', message: 'a workflow must declare at least one step' });
    throw new WorkflowCompileError(issues);
  }

  if (isNegative(spec.budget) || isZero(spec.budget)) {
    issues.push({
      code: 'INVALID_BUDGET',
      message: `workflow budget must be positive, received ${formatMoney(spec.budget)}`,
    });
  }

  // --- Identity ---------------------------------------------------------
  const byId = new Map<string, WorkflowStepSpec>();
  for (const step of spec.steps) {
    if (!STEP_ID_PATTERN.test(step.id)) {
      issues.push({
        code: 'INVALID_STEP_ID',
        stepId: step.id,
        message:
          `step id "${step.id}" must be lower snake_case starting with a letter ` +
          '(it is used verbatim in condition references)',
      });
      continue;
    }
    if (byId.has(step.id)) {
      issues.push({
        code: 'DUPLICATE_STEP_ID',
        stepId: step.id,
        message: `step id "${step.id}" is declared more than once`,
      });
      continue;
    }
    byId.set(step.id, step);
  }

  // --- Per-step rules ---------------------------------------------------
  for (const step of byId.values()) {
    for (const dependency of step.dependsOn ?? []) {
      if (dependency === step.id) {
        issues.push({
          code: 'SELF_DEPENDENCY',
          stepId: step.id,
          message: `step "${step.id}" depends on itself`,
        });
      } else if (!byId.has(dependency)) {
        issues.push({
          code: 'UNKNOWN_DEPENDENCY',
          stepId: step.id,
          message: `step "${step.id}" depends on "${dependency}", which is not declared`,
        });
      }
    }

    if (SPENDING_KINDS.has(step.kind)) {
      if (!step.maxSpend) {
        issues.push({
          code: 'MISSING_SPEND_CAP',
          stepId: step.id,
          message:
            `"${step.kind}" step "${step.id}" must declare maxSpend; ` +
            'an uncapped money-moving step cannot be authorised',
        });
      } else if (isNegative(step.maxSpend) || isZero(step.maxSpend)) {
        issues.push({
          code: 'INVALID_SPEND_CAP',
          stepId: step.id,
          message: `step "${step.id}" has a non-positive maxSpend ${formatMoney(step.maxSpend)}`,
        });
      } else if (step.maxSpend.asset !== spec.budget.asset) {
        issues.push({
          code: 'ASSET_MISMATCH',
          stepId: step.id,
          message:
            `step "${step.id}" spends ${step.maxSpend.asset} but the workflow budget is ` +
            `denominated in ${spec.budget.asset}`,
        });
      }
    } else if (step.maxSpend) {
      issues.push({
        code: 'UNEXPECTED_SPEND_CAP',
        stepId: step.id,
        message: `"${step.kind}" step "${step.id}" declares maxSpend but does not move funds`,
      });
    }

    if (step.kind === 'compensate') {
      if (!step.compensates) {
        issues.push({
          code: 'MISSING_COMPENSATION_TARGET',
          stepId: step.id,
          message: `compensate step "${step.id}" must name the pay step it reverses`,
        });
      } else {
        const target = byId.get(step.compensates);
        if (!target) {
          issues.push({
            code: 'UNKNOWN_COMPENSATION_TARGET',
            stepId: step.id,
            message: `step "${step.id}" compensates "${step.compensates}", which is not declared`,
          });
        } else if (target.kind !== 'pay') {
          issues.push({
            code: 'INVALID_COMPENSATION_TARGET',
            stepId: step.id,
            message:
              `step "${step.id}" compensates "${step.compensates}", which is a ` +
              `"${target.kind}" step; only a pay step can be compensated`,
          });
        }
      }
    } else if (step.compensates) {
      issues.push({
        code: 'UNEXPECTED_COMPENSATION_TARGET',
        stepId: step.id,
        message: `"${step.kind}" step "${step.id}" declares compensates but is not a compensate step`,
      });
    }

    if (step.description.trim() === '') {
      issues.push({
        code: 'MISSING_DESCRIPTION',
        stepId: step.id,
        message: `step "${step.id}" needs a description; it is shown at the approval gate`,
      });
    }
  }

  // Fail before graph analysis if the node set itself is unsound: cycle
  // detection over dangling edges produces misleading messages.
  if (issues.length > 0) {
    throw new WorkflowCompileError(issues);
  }

  // --- Cycle detection --------------------------------------------------
  const cycle = findCycle(byId);
  if (cycle) {
    throw new WorkflowCompileError([
      {
        code: 'CYCLE',
        message: `dependency cycle: ${cycle.join(' -> ')}`,
      },
    ]);
  }

  // --- Topological order (deterministic) --------------------------------
  const order = topologicalOrder(byId, spec.steps);
  const ancestorsById = computeAncestors(byId, order);

  // --- Condition references --------------------------------------------
  for (const step of byId.values()) {
    if (!step.when) continue;
    for (const ref of collectRefs(step.when)) {
      const match = STEP_REF_PATTERN.exec(ref);
      if (!match) continue; // non-step refs (budget.*, goal.*) are resolved at runtime
      const referenced = match[1] as string;
      if (!byId.has(referenced)) {
        issues.push({
          code: 'UNKNOWN_CONDITION_REF',
          stepId: step.id,
          message:
            `step "${step.id}" has condition ${describeCondition(step.when)} referencing ` +
            `unknown step "${referenced}"`,
        });
      } else if (referenced !== step.id && !ancestorsById.get(step.id)?.has(referenced)) {
        // Reading a non-ancestor's output is a race: the value may or may not
        // exist depending on execution interleaving, which destroys replay.
        issues.push({
          code: 'CONDITION_REF_NOT_ANCESTOR',
          stepId: step.id,
          message:
            `step "${step.id}" reads "${referenced}" but does not depend on it; ` +
            `add "${referenced}" to dependsOn so the value is guaranteed to exist`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new WorkflowCompileError(issues);
  }

  // --- Assemble ---------------------------------------------------------
  const dependentsById = new Map<string, string[]>();
  for (const id of byId.keys()) dependentsById.set(id, []);
  for (const step of byId.values()) {
    for (const dependency of step.dependsOn ?? []) {
      dependentsById.get(dependency)?.push(step.id);
    }
  }

  const depthById = new Map<string, number>();
  for (const id of order) {
    const step = byId.get(id) as WorkflowStepSpec;
    const dependencies = step.dependsOn ?? [];
    const depth =
      dependencies.length === 0
        ? 0
        : Math.max(...dependencies.map((d) => (depthById.get(d) ?? 0) + 1));
    depthById.set(id, depth);
  }

  const steps = new Map<string, CompiledStep>();
  for (const id of order) {
    const step = byId.get(id) as WorkflowStepSpec;
    steps.set(id, {
      ...step,
      dependsOn: [...(step.dependsOn ?? [])],
      dependents: [...(dependentsById.get(id) ?? [])].sort(),
      ancestors: ancestorsById.get(id) ?? new Set<string>(),
      depth: depthById.get(id) ?? 0,
    });
  }

  const levels: string[][] = [];
  for (const id of order) {
    const depth = depthById.get(id) ?? 0;
    (levels[depth] ??= []).push(id);
  }

  const spendingSteps = order.filter((id) => SPENDING_KINDS.has((steps.get(id) as CompiledStep).kind));
  const approvalGates = order.filter((id) => (steps.get(id) as CompiledStep).requiresApproval === true);

  // Worst case: every conditional branch taken. Compensation is excluded
  // because it returns funds rather than committing new spend.
  const maxTheoreticalSpend = spendingSteps
    .map((id) => steps.get(id) as CompiledStep)
    .filter((step) => step.kind === 'pay')
    .reduce<Money>(
      (total, step) => ({
        asset: total.asset,
        units: total.units + (step.maxSpend?.units ?? 0n),
      }),
      { asset: spec.budget.asset, units: 0n },
    );

  return {
    id: spec.id,
    tenantId: spec.tenantId,
    goal: spec.goal,
    budget: spec.budget,
    steps,
    order,
    levels,
    approvalGates,
    spendingSteps,
    maxTheoreticalSpend,
  };
}

/**
 * Depth-first cycle search returning the offending path.
 *
 * A path is far more useful than a boolean when a generated plan has a
 * six-step loop buried in it.
 */
function findCycle(byId: ReadonlyMap<string, WorkflowStepSpec>): readonly string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of byId.keys()) colour.set(id, WHITE);
  const stack: string[] = [];

  const visit = (id: string): readonly string[] | null => {
    colour.set(id, GREY);
    stack.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      const state = colour.get(dependency);
      if (state === GREY) {
        const start = stack.indexOf(dependency);
        return [...stack.slice(start), dependency];
      }
      if (state === WHITE) {
        const found = visit(dependency);
        if (found) return found;
      }
    }
    stack.pop();
    colour.set(id, BLACK);
    return null;
  };

  for (const id of byId.keys()) {
    if (colour.get(id) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Kahn's algorithm with a declaration-order tiebreak.
 *
 * The tiebreak matters: replay compares two runs of the same spec, so the
 * order must be identical every time rather than depending on Map iteration
 * or Set insertion happenstance.
 */
function topologicalOrder(
  byId: ReadonlyMap<string, WorkflowStepSpec>,
  declaration: readonly WorkflowStepSpec[],
): readonly string[] {
  const position = new Map<string, number>();
  declaration.forEach((step, index) => {
    if (!position.has(step.id)) position.set(step.id, index);
  });

  const remaining = new Map<string, number>();
  for (const [id, step] of byId) {
    remaining.set(id, (step.dependsOn ?? []).length);
  }

  const ready = [...remaining.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));

  const dependents = new Map<string, string[]>();
  for (const id of byId.keys()) dependents.set(id, []);
  for (const [id, step] of byId) {
    for (const dependency of step.dependsOn ?? []) {
      dependents.get(dependency)?.push(id);
    }
  }

  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const count = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, count);
      if (count === 0) {
        ready.push(dependent);
        ready.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
      }
    }
  }

  return order;
}

/** Transitive prerequisite closure for every step, computed in topological order. */
function computeAncestors(
  byId: ReadonlyMap<string, WorkflowStepSpec>,
  order: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const ancestors = new Map<string, Set<string>>();
  for (const id of order) {
    const set = new Set<string>();
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      set.add(dependency);
      for (const inherited of ancestors.get(dependency) ?? []) set.add(inherited);
    }
    ancestors.set(id, set);
  }
  return ancestors;
}

/** Execution state of a single step, as recorded by the durable runner. */
export type StepStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/** Statuses that permanently resolve a step, unblocking its dependents. */
const RESOLVED: ReadonlySet<StepStatus> = new Set<StepStatus>([
  'succeeded',
  'skipped',
  'failed',
  'cancelled',
]);

/** Statuses that satisfy a dependency well enough for a dependent to run. */
const SATISFYING: ReadonlySet<StepStatus> = new Set<StepStatus>(['succeeded', 'skipped']);

export function isResolved(status: StepStatus): boolean {
  return RESOLVED.has(status);
}

/**
 * Steps whose prerequisites have all succeeded or been skipped.
 *
 * A failed or cancelled prerequisite does *not* release its dependents:
 * the branch is dead, and the runner marks descendants skipped rather than
 * running them against a missing output.
 */
export function readySteps(
  workflow: CompiledWorkflow,
  statuses: ReadonlyMap<string, StepStatus>,
): readonly string[] {
  return workflow.order.filter((id) => {
    const status = statuses.get(id) ?? 'pending';
    if (status !== 'pending' && status !== 'ready') return false;
    const step = workflow.steps.get(id) as CompiledStep;
    return step.dependsOn.every((dependency) =>
      SATISFYING.has(statuses.get(dependency) ?? 'pending'),
    );
  });
}

/**
 * Steps that can never run because a prerequisite is dead.
 *
 * The runner marks these `skipped` so a cancelled workflow closes cleanly
 * and the ledger can state exactly what was not purchased.
 */
export function unreachableSteps(
  workflow: CompiledWorkflow,
  statuses: ReadonlyMap<string, StepStatus>,
): readonly string[] {
  const dead = new Set<string>();
  for (const id of workflow.order) {
    const status = statuses.get(id) ?? 'pending';
    if (status === 'failed' || status === 'cancelled') {
      dead.add(id);
      continue;
    }
    if (isResolved(status)) continue;
    const step = workflow.steps.get(id) as CompiledStep;
    if (step.dependsOn.some((dependency) => dead.has(dependency))) {
      dead.add(id);
    }
  }
  // Only report steps that have not already been resolved.
  return workflow.order.filter((id) => {
    const status = statuses.get(id) ?? 'pending';
    return dead.has(id) && !isResolved(status);
  });
}

/** All transitive descendants of a step, in topological order. */
export function descendantsOf(workflow: CompiledWorkflow, stepId: string): readonly string[] {
  return workflow.order.filter((id) => workflow.steps.get(id)?.ancestors.has(stepId) === true);
}
