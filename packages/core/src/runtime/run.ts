/**
 * Workflow run state and its transitions.
 *
 * A run is the durable execution of a compiled workflow. Everything here is
 * a pure reducer over immutable state: given the same run and the same
 * sequence of results, the resulting state and trace are byte-identical.
 * That is the property replay depends on, and it is why this module holds no
 * Firebase import and never reads the ambient clock — `now` is a parameter.
 *
 * The store's only job is to persist what these reducers produce and to
 * enforce the fencing token on write. All the decisions live here.
 */

import {
  type CompiledStep,
  type CompiledWorkflow,
  readySteps,
  type StepStatus,
  unreachableSteps,
} from '../workflow/graph.js';
import { type Condition, type ConditionResult, evaluateCondition } from '../workflow/condition.js';
import { type BudgetState, exposure } from '../policy/budget.js';
import { type Lease, mayCommit } from './lease.js';

export type RunStatus = 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';

export interface StepRecord {
  readonly stepId: string;
  readonly status: StepStatus;
  /** Execution attempts, including the current one. */
  readonly attempt: number;
  readonly lease: Lease | null;
  /** Whatever the agent produced. Read by conditions on descendant steps. */
  readonly output: unknown;
  readonly error: string | null;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  /** Why a step was skipped, for the ledger's "what was not purchased" view. */
  readonly skipReason: string | null;
}

export type TraceEventType =
  | 'run_created'
  | 'step_claimed'
  | 'step_started'
  | 'step_succeeded'
  | 'step_failed'
  | 'step_skipped'
  | 'step_awaiting_approval'
  | 'step_approved'
  | 'step_rejected'
  | 'commit_refused'
  | 'run_paused'
  | 'run_resumed'
  | 'run_cancelled'
  | 'run_finished';

/**
 * One immutable entry in the run's audit trail.
 *
 * `seq` is a per-run counter, not a timestamp: two events in the same
 * millisecond must still have a defined order for a judge replaying the run.
 */
export interface TraceEvent {
  readonly seq: number;
  readonly at: number;
  readonly type: TraceEventType;
  readonly stepId: string | null;
  readonly summary: string;
  /** Structured payload for the trace viewer. JSON-safe. */
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface RunState {
  readonly runId: string;
  readonly workflowId: string;
  readonly tenantId: string;
  readonly status: RunStatus;
  readonly steps: ReadonlyMap<string, StepRecord>;
  readonly budget: BudgetState;
  readonly trace: readonly TraceEvent[];
  readonly createdAt: number;
  readonly finishedAt: number | null;
}

export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunError';
  }
}

function emptyRecord(stepId: string): StepRecord {
  return {
    stepId,
    status: 'pending',
    attempt: 0,
    lease: null,
    output: null,
    error: null,
    startedAt: null,
    completedAt: null,
    skipReason: null,
  };
}

function append(
  run: RunState,
  at: number,
  type: TraceEventType,
  stepId: string | null,
  summary: string,
  detail: Readonly<Record<string, unknown>> = {},
): readonly TraceEvent[] {
  return [
    ...run.trace,
    { seq: run.trace.length + 1, at, type, stepId, summary, detail },
  ];
}

function withRecord(run: RunState, record: StepRecord): ReadonlyMap<string, StepRecord> {
  const steps = new Map(run.steps);
  steps.set(record.stepId, record);
  return steps;
}

export function createRun(input: {
  readonly runId: string;
  readonly workflow: CompiledWorkflow;
  readonly budget: BudgetState;
  readonly at: number;
}): RunState {
  const steps = new Map<string, StepRecord>();
  for (const stepId of input.workflow.order) {
    steps.set(stepId, emptyRecord(stepId));
  }
  const base: RunState = {
    runId: input.runId,
    workflowId: input.workflow.id,
    tenantId: input.workflow.tenantId,
    status: 'running',
    steps,
    budget: input.budget,
    trace: [],
    createdAt: input.at,
    finishedAt: null,
  };
  return {
    ...base,
    trace: append(base, input.at, 'run_created', null, `run ${input.runId} created`, {
      workflowId: input.workflow.id,
      goal: input.workflow.goal,
      stepCount: input.workflow.order.length,
      budget: input.workflow.budget.units.toString(),
    }),
  };
}

export function statusMap(run: RunState): ReadonlyMap<string, StepStatus> {
  const statuses = new Map<string, StepStatus>();
  for (const [stepId, record] of run.steps) statuses.set(stepId, record.status);
  return statuses;
}

/**
 * Context a condition is evaluated against.
 *
 * Only *resolved* step outputs are exposed. A running step's partial state is
 * deliberately invisible, so a condition cannot read a value that would
 * differ between a live run and a replay.
 */
export function conditionContext(run: RunState): Record<string, unknown> {
  const steps: Record<string, unknown> = {};
  for (const [stepId, record] of run.steps) {
    if (record.status === 'succeeded') {
      steps[stepId] = { output: record.output };
    }
  }
  const view = exposure(run.budget);
  return {
    steps,
    budget: {
      remaining: view.available,
      committed: view.committed,
      settled: view.settled,
    },
  };
}

/** What the runner should do with a step that has become ready. */
export type Disposition =
  | { readonly action: 'run' }
  | { readonly action: 'skip'; readonly reason: string }
  | { readonly action: 'await_approval' };

/**
 * Decide whether a ready step should execute, be skipped, or pause.
 *
 * Two independent reasons to skip, and the order matters:
 *
 *  1. **Branch pruning.** If every prerequisite was skipped, this step is on
 *     a dead branch and is skipped without evaluating its condition — the
 *     outputs its condition would read do not exist. A step with at least one
 *     succeeded prerequisite is a join point and still runs.
 *  2. **Conditional edge.** The step's own `when` evaluated to false.
 */
export function disposition(
  run: RunState,
  step: CompiledStep,
  workflow: CompiledWorkflow,
): Disposition {
  if (step.dependsOn.length > 0) {
    const allSkipped = step.dependsOn.every(
      (dependency) => run.steps.get(dependency)?.status === 'skipped',
    );
    if (allSkipped) {
      return {
        action: 'skip',
        reason: `every prerequisite was skipped (${step.dependsOn.join(', ')}), so this branch is dead`,
      };
    }
  }

  if (step.when) {
    const result = evaluateCondition(step.when, conditionContext(run));
    if (!result.value) {
      return { action: 'skip', reason: describeSkip(step.when, result) };
    }
  }

  if (step.requiresApproval === true) {
    return { action: 'await_approval' };
  }

  void workflow;
  return { action: 'run' };
}

function describeSkip(condition: Condition, result: ConditionResult): string {
  const reads = result.resolutions
    .map((resolution) => `${resolution.ref}=${JSON.stringify(resolution.resolved) ?? 'undefined'}`)
    .join(', ');
  void condition;
  return reads === ''
    ? 'condition evaluated false'
    : `condition evaluated false with ${reads}`;
}

/** Steps that are ready and not currently leased by a live runner. */
export function claimableSteps(
  run: RunState,
  workflow: CompiledWorkflow,
  now: number,
): readonly string[] {
  if (run.status !== 'running') return [];
  return readySteps(workflow, statusMap(run)).filter((stepId) => {
    const record = run.steps.get(stepId);
    if (!record) return false;
    if (record.lease === null) return true;
    return now >= record.lease.expiresAt;
  });
}

/** Record that a runner has taken a step, before it begins work. */
export function markClaimed(
  run: RunState,
  stepId: string,
  lease: Lease,
  now: number,
): RunState {
  const record = run.steps.get(stepId);
  if (!record) throw new RunError(`run ${run.runId} has no step "${stepId}"`);
  const updated: StepRecord = {
    ...record,
    status: 'running',
    attempt: record.attempt + 1,
    lease,
    startedAt: now,
  };
  return {
    ...run,
    steps: withRecord(run, updated),
    trace: append(run, now, 'step_claimed', stepId, `"${stepId}" claimed by ${lease.owner}`, {
      owner: lease.owner,
      fenceToken: lease.fenceToken,
      attempt: updated.attempt,
      expiresAt: lease.expiresAt,
    }),
  };
}

/**
 * Commit a successful step result.
 *
 * Refuses and records the refusal when the presented fencing token is stale —
 * a runner that stalled past its lease must not overwrite fresher work. The
 * refusal is a trace event rather than a thrown error because it is an
 * expected outcome under concurrency, not a bug.
 */
export function completeStep(
  run: RunState,
  input: {
    readonly stepId: string;
    readonly owner: string;
    readonly fenceToken: number;
    readonly output: unknown;
    readonly at: number;
  },
): RunState {
  const record = run.steps.get(input.stepId);
  if (!record) throw new RunError(`run ${run.runId} has no step "${input.stepId}"`);

  if (!mayCommit(record.lease, input.owner, input.fenceToken, input.at)) {
    return refuseCommit(run, record, input.owner, input.fenceToken, input.at);
  }

  const updated: StepRecord = {
    ...record,
    status: 'succeeded',
    lease: null,
    output: input.output,
    error: null,
    completedAt: input.at,
  };
  return {
    ...run,
    steps: withRecord(run, updated),
    trace: append(run, input.at, 'step_succeeded', input.stepId, `"${input.stepId}" succeeded`, {
      owner: input.owner,
      attempt: record.attempt,
      durationMs: record.startedAt === null ? null : input.at - record.startedAt,
    }),
  };
}

export function failStep(
  run: RunState,
  input: {
    readonly stepId: string;
    readonly owner: string;
    readonly fenceToken: number;
    readonly error: string;
    readonly at: number;
    /** When true the step returns to pending for another attempt. */
    readonly retryable?: boolean;
  },
): RunState {
  const record = run.steps.get(input.stepId);
  if (!record) throw new RunError(`run ${run.runId} has no step "${input.stepId}"`);

  if (!mayCommit(record.lease, input.owner, input.fenceToken, input.at)) {
    return refuseCommit(run, record, input.owner, input.fenceToken, input.at);
  }

  const retryable = input.retryable === true;
  const updated: StepRecord = {
    ...record,
    status: retryable ? 'pending' : 'failed',
    lease: null,
    error: input.error,
    completedAt: retryable ? null : input.at,
  };
  return {
    ...run,
    steps: withRecord(run, updated),
    trace: append(
      run,
      input.at,
      'step_failed',
      input.stepId,
      `"${input.stepId}" failed: ${input.error}`,
      { owner: input.owner, attempt: record.attempt, retryable },
    ),
  };
}

function refuseCommit(
  run: RunState,
  record: StepRecord,
  owner: string,
  fenceToken: number,
  at: number,
): RunState {
  return {
    ...run,
    trace: append(
      run,
      at,
      'commit_refused',
      record.stepId,
      `write from "${owner}" refused for "${record.stepId}"`,
      {
        owner,
        presentedToken: fenceToken,
        currentToken: record.lease?.fenceToken ?? null,
        currentOwner: record.lease?.owner ?? null,
      },
    ),
  };
}

/** Mark a step skipped — a pruned branch or a false condition. */
export function skipStep(run: RunState, stepId: string, reason: string, at: number): RunState {
  const record = run.steps.get(stepId);
  if (!record) throw new RunError(`run ${run.runId} has no step "${stepId}"`);
  const updated: StepRecord = {
    ...record,
    status: 'skipped',
    lease: null,
    completedAt: at,
    skipReason: reason,
  };
  return {
    ...run,
    steps: withRecord(run, updated),
    trace: append(run, at, 'step_skipped', stepId, `"${stepId}" skipped: ${reason}`, { reason }),
  };
}

/** Pause a step at a human approval gate. */
export function awaitApproval(run: RunState, stepId: string, at: number): RunState {
  const record = run.steps.get(stepId);
  if (!record) throw new RunError(`run ${run.runId} has no step "${stepId}"`);
  const updated: StepRecord = { ...record, status: 'awaiting_approval', lease: null };
  return {
    ...run,
    steps: withRecord(run, updated),
    trace: append(
      run,
      at,
      'step_awaiting_approval',
      stepId,
      `"${stepId}" is waiting for a human decision`,
      {},
    ),
  };
}

export function resolveApproval(
  run: RunState,
  input: {
    readonly stepId: string;
    readonly approved: boolean;
    readonly decidedBy: string;
    readonly note?: string;
    readonly at: number;
  },
): RunState {
  const record = run.steps.get(input.stepId);
  if (!record) throw new RunError(`run ${run.runId} has no step "${input.stepId}"`);
  if (record.status !== 'awaiting_approval') {
    throw new RunError(
      `"${input.stepId}" is ${record.status}, not awaiting approval; ` +
        'an approval decision would be applied to the wrong state',
    );
  }

  const updated: StepRecord = input.approved
    ? { ...record, status: 'pending' }
    : {
        ...record,
        status: 'skipped',
        completedAt: input.at,
        skipReason: `rejected by ${input.decidedBy}`,
      };

  return {
    ...run,
    steps: withRecord(run, updated),
    trace: append(
      run,
      input.at,
      input.approved ? 'step_approved' : 'step_rejected',
      input.stepId,
      `"${input.stepId}" ${input.approved ? 'approved' : 'rejected'} by ${input.decidedBy}`,
      { decidedBy: input.decidedBy, note: input.note ?? null },
    ),
  };
}

/**
 * Cancel the run and close out every step that can no longer happen.
 *
 * This produces the "what is delivered, what is not purchased" view the
 * handbook asks for after a mid-workflow cancellation: settled steps keep
 * their results, everything unreachable is marked cancelled with a reason.
 */
export function cancelRun(
  run: RunState,
  workflow: CompiledWorkflow,
  input: { readonly reason: string; readonly by: string; readonly at: number },
): RunState {
  if (run.status !== 'running' && run.status !== 'paused') return run;

  let next: RunState = {
    ...run,
    trace: append(run, input.at, 'run_cancelled', null, `run cancelled: ${input.reason}`, {
      by: input.by,
      reason: input.reason,
    }),
  };

  for (const stepId of workflow.order) {
    const record = next.steps.get(stepId);
    if (!record) continue;
    if (record.status === 'succeeded' || record.status === 'failed') continue;
    if (record.status === 'skipped' || record.status === 'cancelled') continue;
    next = {
      ...next,
      steps: withRecord(next, {
        ...record,
        status: 'cancelled',
        lease: null,
        completedAt: input.at,
        skipReason: `run cancelled: ${input.reason}`,
      }),
    };
  }

  return { ...next, status: 'cancelled', finishedAt: input.at };
}

/** Halt the run without closing steps — the admin kill switch. */
export function pauseRun(run: RunState, reason: string, at: number): RunState {
  if (run.status !== 'running') return run;
  return {
    ...run,
    status: 'paused',
    trace: append(run, at, 'run_paused', null, `run paused: ${reason}`, { reason }),
  };
}

export function resumeRun(run: RunState, at: number): RunState {
  if (run.status !== 'paused') return run;
  return {
    ...run,
    status: 'running',
    trace: append(run, at, 'run_resumed', null, 'run resumed', {}),
  };
}

/**
 * Settle the run's terminal status once no step can advance.
 *
 * A run succeeds when every step resolved and none failed. It fails when any
 * step failed outright — a failed step's descendants are already unreachable.
 */
export function finalise(run: RunState, workflow: CompiledWorkflow, at: number): RunState {
  if (run.status !== 'running') return run;

  const records = workflow.order.map((stepId) => run.steps.get(stepId) as StepRecord);
  const anyRunning = records.some(
    (record) => record.status === 'running' || record.status === 'awaiting_approval',
  );
  if (anyRunning) return run;

  const stillClaimable = claimableSteps(run, workflow, at).length > 0;
  const pendingButBlocked = unreachableSteps(workflow, statusMap(run));
  if (stillClaimable) return run;

  // Close out anything permanently blocked before deciding the outcome.
  let next = run;
  for (const stepId of pendingButBlocked) {
    next = skipStep(next, stepId, 'a prerequisite failed or was cancelled', at);
  }

  const anyPending = workflow.order.some((stepId) => {
    const status = next.steps.get(stepId)?.status;
    return status === 'pending' || status === 'ready';
  });
  if (anyPending) return next;

  const failed = workflow.order.filter((stepId) => next.steps.get(stepId)?.status === 'failed');
  const status: RunStatus = failed.length > 0 ? 'failed' : 'succeeded';

  return {
    ...next,
    status,
    finishedAt: at,
    trace: append(next, at, 'run_finished', null, `run ${status}`, {
      failedSteps: failed,
      settled: exposure(next.budget).settled.units.toString(),
    }),
  };
}
