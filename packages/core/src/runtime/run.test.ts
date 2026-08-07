import { describe, expect, it } from 'vitest';
import { parseAmount } from '../money.js';
import { createBudget } from '../policy/budget.js';
import { compileWorkflow, type WorkflowSpec, type WorkflowStepSpec } from '../workflow/graph.js';
import { claim, type Lease } from './lease.js';
import {
  awaitApproval,
  cancelRun,
  claimableSteps,
  completeStep,
  conditionContext,
  createRun,
  disposition,
  failStep,
  finalise,
  markClaimed,
  pauseRun,
  resolveApproval,
  resumeRun,
  RunError,
  type RunState,
  skipStep,
} from './run.js';

const usdc = (amount: string) => parseAmount('USDC', amount);
const T0 = 1_700_000_000_000;

function step(overrides: Partial<WorkflowStepSpec> & { id: string }): WorkflowStepSpec {
  return {
    kind: 'discover',
    role: 'procurement',
    description: `step ${overrides.id}`,
    ...overrides,
  };
}

function build(steps: readonly WorkflowStepSpec[]) {
  const spec: WorkflowSpec = {
    id: 'wf_demo',
    tenantId: 'tenant_a',
    goal: 'restock chilled cargo',
    budget: usdc('500'),
    steps,
  };
  const workflow = compileWorkflow(spec);
  const run = createRun({
    runId: 'run_1',
    workflow,
    budget: createBudget({ asset: 'USDC', workflowCap: usdc('500') }),
    at: T0,
  });
  return { workflow, run };
}

/** Linear chain: a -> b -> c. */
function chain() {
  return build([
    step({ id: 'a' }),
    step({ id: 'b', dependsOn: ['a'] }),
    step({ id: 'c', dependsOn: ['b'] }),
  ]);
}

function take(current: Lease | null, owner: string, now: number): Lease {
  const result = claim(current, owner, now);
  if (!result.ok) throw new Error(result.message);
  return result.lease;
}

/** Claim and complete a step in one move, for setting up later state. */
function runStep(run: RunState, stepId: string, output: unknown, at: number): RunState {
  const lease = take(run.steps.get(stepId)?.lease ?? null, 'runner:test', at);
  const claimed = markClaimed(run, stepId, lease, at);
  return completeStep(claimed, {
    stepId,
    owner: 'runner:test',
    fenceToken: lease.fenceToken,
    output,
    at: at + 100,
  });
}

describe('createRun', () => {
  it('initialises every step as pending', () => {
    const { run } = chain();
    expect([...run.steps.values()].every((record) => record.status === 'pending')).toBe(true);
  });

  it('opens the trace with a run_created event', () => {
    const { run } = chain();
    expect(run.trace).toHaveLength(1);
    expect(run.trace[0]).toMatchObject({ seq: 1, type: 'run_created' });
  });

  it('starts in the running status with no finish time', () => {
    const { run } = chain();
    expect(run.status).toBe('running');
    expect(run.finishedAt).toBeNull();
  });
});

describe('trace', () => {
  it('numbers events from 1 with no gaps, so replay has a total order', () => {
    const { run } = chain();
    const after = runStep(run, 'a', { ok: true }, T0);
    expect(after.trace.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('orders two events in the same millisecond deterministically', () => {
    const { run } = chain();
    const lease = take(null, 'runner:test', T0);
    const claimed = markClaimed(run, 'a', lease, T0);
    const done = completeStep(claimed, {
      stepId: 'a',
      owner: 'runner:test',
      fenceToken: lease.fenceToken,
      output: null,
      at: T0,
    });
    const sameMs = done.trace.filter((event) => event.at === T0);
    expect(sameMs.map((e) => e.type)).toEqual(['run_created', 'step_claimed', 'step_succeeded']);
  });

  it('is append-only: earlier events are never rewritten', () => {
    const { run } = chain();
    const after = runStep(run, 'a', { ok: true }, T0);
    expect(after.trace.slice(0, 1)).toEqual(run.trace);
  });
});

describe('claimableSteps', () => {
  it('offers only the root step initially', () => {
    const { workflow, run } = chain();
    expect(claimableSteps(run, workflow, T0)).toEqual(['a']);
  });

  it('withholds a step already leased by a live runner', () => {
    const { workflow, run } = chain();
    const claimed = markClaimed(run, 'a', take(null, 'runner:1', T0), T0);
    expect(claimableSteps(claimed, workflow, T0 + 1_000)).toEqual([]);
  });

  it('re-offers a step whose lease expired', () => {
    const { workflow, run } = chain();
    const claimed = markClaimed(run, 'a', take(null, 'runner:1', T0), T0);
    expect(claimableSteps(claimed, workflow, T0 + 60_000)).toEqual(['a']);
  });

  it('recovers a step abandoned by a crashed runner', () => {
    // Runner 1 claims and dies mid-turn. Without reclaim, the step stays
    // `running` forever and the whole workflow is wedged.
    const { workflow, run } = chain();
    const dead = markClaimed(run, 'a', take(null, 'runner:1', T0), T0);
    expect(dead.steps.get('a')?.status).toBe('running');

    expect(claimableSteps(dead, workflow, T0 + 60_000)).toEqual(['a']);

    const recovered = runStep(dead, 'a', { ok: true }, T0 + 60_000);
    expect(recovered.steps.get('a')?.status).toBe('succeeded');
    expect(claimableSteps(recovered, workflow, T0 + 61_000)).toEqual(['b']);
  });

  it('does not offer the same step twice when it is both abandoned and ready', () => {
    const { workflow, run } = chain();
    const dead = markClaimed(run, 'a', take(null, 'runner:1', T0), T0);
    expect(claimableSteps(dead, workflow, T0 + 120_000)).toEqual(['a']);
  });

  it('offers nothing while the run is paused', () => {
    const { workflow, run } = chain();
    expect(claimableSteps(pauseRun(run, 'kill switch', T0), workflow, T0)).toEqual([]);
  });

  it('advances to the next step once its prerequisite succeeds', () => {
    const { workflow, run } = chain();
    expect(claimableSteps(runStep(run, 'a', null, T0), workflow, T0 + 200)).toEqual(['b']);
  });
});

describe('completeStep — fencing', () => {
  it('commits a result from the live lease holder', () => {
    const { run } = chain();
    const after = runStep(run, 'a', { carrier: 'MaerskSim' }, T0);
    expect(after.steps.get('a')?.status).toBe('succeeded');
    expect(after.steps.get('a')?.output).toEqual({ carrier: 'MaerskSim' });
  });

  it('clears the lease on completion so successors are not blocked', () => {
    const { run } = chain();
    expect(runStep(run, 'a', null, T0).steps.get('a')?.lease).toBeNull();
  });

  it('discards a stalled runner\'s write and keeps the fresher result', () => {
    // Runner 1 claims, stalls. Runner 2 reclaims after expiry and succeeds.
    // Runner 1 then wakes and tries to write.
    const { run } = chain();
    const first = take(null, 'runner:1', T0);
    let state = markClaimed(run, 'a', first, T0);

    const second = take(first, 'runner:2', T0 + 60_000);
    state = markClaimed(state, 'a', second, T0 + 60_000);
    state = completeStep(state, {
      stepId: 'a',
      owner: 'runner:2',
      fenceToken: second.fenceToken,
      output: { winner: 'runner:2' },
      at: T0 + 60_500,
    });

    const stale = completeStep(state, {
      stepId: 'a',
      owner: 'runner:1',
      fenceToken: first.fenceToken,
      output: { winner: 'runner:1' },
      at: T0 + 61_000,
    });

    expect(stale.steps.get('a')?.output).toEqual({ winner: 'runner:2' });
  });

  it('records the refusal in the trace rather than throwing', () => {
    // Concurrency losses are expected, not exceptional.
    const { run } = chain();
    const lease = take(null, 'runner:1', T0);
    const state = markClaimed(run, 'a', lease, T0);
    const refused = completeStep(state, {
      stepId: 'a',
      owner: 'runner:2',
      fenceToken: 99,
      output: null,
      at: T0 + 100,
    });
    const event = refused.trace.at(-1);
    expect(event?.type).toBe('commit_refused');
    expect(event?.detail).toMatchObject({ presentedToken: 99, currentToken: 1 });
  });

  it('counts attempts across reclaims', () => {
    const { run } = chain();
    const first = take(null, 'runner:1', T0);
    let state = markClaimed(run, 'a', first, T0);
    state = markClaimed(state, 'a', take(first, 'runner:2', T0 + 60_000), T0 + 60_000);
    expect(state.steps.get('a')?.attempt).toBe(2);
  });

  it('throws for an unknown step id', () => {
    const { run } = chain();
    expect(() =>
      completeStep(run, { stepId: 'ghost', owner: 'x', fenceToken: 1, output: null, at: T0 }),
    ).toThrow(RunError);
  });
});

describe('failStep', () => {
  it('marks a step failed and records the error', () => {
    const { run } = chain();
    const lease = take(null, 'runner:1', T0);
    const state = markClaimed(run, 'a', lease, T0);
    const failed = failStep(state, {
      stepId: 'a',
      owner: 'runner:1',
      fenceToken: lease.fenceToken,
      error: 'provider returned 503',
      at: T0 + 100,
    });
    expect(failed.steps.get('a')?.status).toBe('failed');
    expect(failed.steps.get('a')?.error).toBe('provider returned 503');
  });

  it('returns a retryable failure to pending for another attempt', () => {
    const { workflow, run } = chain();
    const lease = take(null, 'runner:1', T0);
    const state = markClaimed(run, 'a', lease, T0);
    const retried = failStep(state, {
      stepId: 'a',
      owner: 'runner:1',
      fenceToken: lease.fenceToken,
      error: 'timeout',
      at: T0 + 100,
      retryable: true,
    });
    expect(retried.steps.get('a')?.status).toBe('pending');
    expect(claimableSteps(retried, workflow, T0 + 200)).toEqual(['a']);
  });

  it('refuses a stale failure write', () => {
    const { run } = chain();
    const lease = take(null, 'runner:1', T0);
    const state = markClaimed(run, 'a', lease, T0);
    const refused = failStep(state, {
      stepId: 'a',
      owner: 'runner:1',
      fenceToken: lease.fenceToken + 5,
      error: 'stale',
      at: T0 + 100,
    });
    expect(refused.steps.get('a')?.status).toBe('running');
  });
});

describe('disposition — conditional edges and branch pruning', () => {
  function branching() {
    return build([
      step({ id: 'inspect' }),
      step({
        id: 'pay_reinspection',
        kind: 'pay',
        role: 'settlement',
        dependsOn: ['inspect'],
        maxSpend: usdc('40'),
        when: { op: 'gt', ref: 'steps.inspect.output.defectRate', value: 0.05 },
      }),
      step({ id: 'file_report', dependsOn: ['pay_reinspection'] }),
      step({ id: 'ship', dependsOn: ['inspect'] }),
    ]);
  }

  it('runs the conditional step when the condition holds', () => {
    const { workflow, run } = branching();
    const state = runStep(run, 'inspect', { defectRate: 0.11 }, T0);
    const compiled = workflow.steps.get('pay_reinspection');
    expect(disposition(state, compiled!, workflow).action).toBe('run');
  });

  it('skips the conditional step when the quality threshold is already met', () => {
    const { workflow, run } = branching();
    const state = runStep(run, 'inspect', { defectRate: 0.01 }, T0);
    const result = disposition(state, workflow.steps.get('pay_reinspection')!, workflow);
    expect(result.action).toBe('skip');
  });

  it('explains the skip with the values it read, for the ledger', () => {
    const { workflow, run } = branching();
    const state = runStep(run, 'inspect', { defectRate: 0.01 }, T0);
    const result = disposition(state, workflow.steps.get('pay_reinspection')!, workflow);
    if (result.action !== 'skip') throw new Error('expected a skip');
    expect(result.reason).toContain('steps.inspect.output.defectRate=0.01');
  });

  it('prunes the descendant of a skipped step without evaluating its condition', () => {
    // file_report depends only on the skipped payment, so it is dead.
    const { workflow, run } = branching();
    let state = runStep(run, 'inspect', { defectRate: 0.01 }, T0);
    state = skipStep(state, 'pay_reinspection', 'quality already met', T0 + 500);
    const result = disposition(state, workflow.steps.get('file_report')!, workflow);
    expect(result.action).toBe('skip');
    if (result.action !== 'skip') throw new Error('expected a skip');
    expect(result.reason).toContain('branch is dead');
  });

  it('still runs a join step that has one succeeded prerequisite', () => {
    // A step depending on both a skipped and a succeeded branch is a join,
    // not a dead branch, and must execute.
    const { workflow, run } = build([
      step({ id: 'left' }),
      step({ id: 'right' }),
      step({ id: 'join', dependsOn: ['left', 'right'] }),
    ]);
    let state = runStep(run, 'left', { ok: true }, T0);
    state = skipStep(state, 'right', 'not needed', T0 + 100);
    expect(disposition(state, workflow.steps.get('join')!, workflow).action).toBe('run');
  });

  it('pauses at an approval gate', () => {
    const { workflow, run } = build([step({ id: 'gate', requiresApproval: true })]);
    expect(disposition(run, workflow.steps.get('gate')!, workflow).action).toBe('await_approval');
  });
});

describe('conditionContext', () => {
  it('exposes only resolved step outputs', () => {
    const { run } = chain();
    const state = markClaimed(run, 'a', take(null, 'runner:1', T0), T0);
    const context = conditionContext(state) as { steps: Record<string, unknown> };
    // `a` is running, not succeeded: its partial state must be invisible.
    expect(context.steps.a).toBeUndefined();
  });

  it('exposes budget headroom for policy conditions', () => {
    const { run } = chain();
    const context = conditionContext(run) as { budget: { remaining: { units: bigint } } };
    expect(context.budget.remaining.units).toBe(usdc('500').units);
  });
});

describe('approval gates', () => {
  function gated() {
    return build([
      step({ id: 'gate', requiresApproval: true }),
      step({ id: 'after', dependsOn: ['gate'] }),
    ]);
  }

  it('holds the step and does not offer it to a runner', () => {
    const { workflow, run } = gated();
    const waiting = awaitApproval(run, 'gate', T0);
    expect(waiting.steps.get('gate')?.status).toBe('awaiting_approval');
    expect(claimableSteps(waiting, workflow, T0 + 100)).toEqual([]);
  });

  it('releases the step once a human approves', () => {
    const { workflow, run } = gated();
    let state = awaitApproval(run, 'gate', T0);
    state = resolveApproval(state, {
      stepId: 'gate',
      approved: true,
      decidedBy: 'ops@tenant_a',
      at: T0 + 5_000,
    });
    expect(claimableSteps(state, workflow, T0 + 5_100)).toEqual(['gate']);
  });

  it('skips the step and names the decider on rejection', () => {
    const { run } = gated();
    let state = awaitApproval(run, 'gate', T0);
    state = resolveApproval(state, {
      stepId: 'gate',
      approved: false,
      decidedBy: 'ops@tenant_a',
      at: T0 + 5_000,
    });
    expect(state.steps.get('gate')?.status).toBe('skipped');
    expect(state.steps.get('gate')?.skipReason).toContain('ops@tenant_a');
  });

  it('refuses a decision on a step that is not waiting', () => {
    // Applying a stale approval to a running step would authorise the wrong work.
    const { run } = gated();
    expect(() =>
      resolveApproval(run, {
        stepId: 'gate',
        approved: true,
        decidedBy: 'ops',
        at: T0,
      }),
    ).toThrow(RunError);
  });

  it('records the decider and note in the trace', () => {
    const { run } = gated();
    let state = awaitApproval(run, 'gate', T0);
    state = resolveApproval(state, {
      stepId: 'gate',
      approved: true,
      decidedBy: 'ops@tenant_a',
      note: 'price checked against index',
      at: T0 + 5_000,
    });
    expect(state.trace.at(-1)?.detail).toMatchObject({
      decidedBy: 'ops@tenant_a',
      note: 'price checked against index',
    });
  });
});

describe('pause and resume — the kill switch', () => {
  it('stops offering work while paused and resumes cleanly', () => {
    const { workflow, run } = chain();
    const paused = pauseRun(run, 'admin kill switch', T0);
    expect(claimableSteps(paused, workflow, T0)).toEqual([]);
    const resumed = resumeRun(paused, T0 + 1_000);
    expect(claimableSteps(resumed, workflow, T0 + 1_000)).toEqual(['a']);
  });

  it('is idempotent in both directions', () => {
    const { run } = chain();
    const paused = pauseRun(run, 'x', T0);
    expect(pauseRun(paused, 'x', T0 + 1)).toBe(paused);
    expect(resumeRun(run, T0 + 1)).toBe(run);
  });
});

describe('cancelRun — closing the ledger mid-workflow', () => {
  it('keeps completed work and cancels everything unreachable', () => {
    // The handbook's demo: cancel after one paid step, then show what is
    // delivered and what was never purchased.
    const { workflow, run } = chain();
    const state = runStep(run, 'a', { paid: true }, T0);
    const cancelled = cancelRun(state, workflow, {
      reason: 'user cancelled',
      by: 'ops@tenant_a',
      at: T0 + 10_000,
    });

    expect(cancelled.steps.get('a')?.status).toBe('succeeded');
    expect(cancelled.steps.get('b')?.status).toBe('cancelled');
    expect(cancelled.steps.get('c')?.status).toBe('cancelled');
    expect(cancelled.status).toBe('cancelled');
  });

  it('gives every cancelled step a reason for the ledger', () => {
    const { workflow, run } = chain();
    const cancelled = cancelRun(run, workflow, {
      reason: 'budget exhausted',
      by: 'system',
      at: T0,
    });
    expect(cancelled.steps.get('b')?.skipReason).toContain('budget exhausted');
  });

  it('does not disturb a step that already failed', () => {
    const { workflow, run } = chain();
    const lease = take(null, 'runner:1', T0);
    let state = markClaimed(run, 'a', lease, T0);
    state = failStep(state, {
      stepId: 'a',
      owner: 'runner:1',
      fenceToken: lease.fenceToken,
      error: 'provider down',
      at: T0 + 100,
    });
    const cancelled = cancelRun(state, workflow, { reason: 'stop', by: 'ops', at: T0 + 200 });
    expect(cancelled.steps.get('a')?.status).toBe('failed');
    expect(cancelled.steps.get('a')?.error).toBe('provider down');
  });

  it('is a no-op once the run already ended', () => {
    const { workflow, run } = chain();
    const once = cancelRun(run, workflow, { reason: 'a', by: 'ops', at: T0 });
    expect(cancelRun(once, workflow, { reason: 'b', by: 'ops', at: T0 + 1 })).toBe(once);
  });
});

describe('finalise', () => {
  it('leaves the run open while work remains', () => {
    const { workflow, run } = chain();
    expect(finalise(run, workflow, T0).status).toBe('running');
  });

  it('leaves the run open while a step is still executing', () => {
    const { workflow, run } = chain();
    const claimed = markClaimed(run, 'a', take(null, 'runner:1', T0), T0);
    expect(finalise(claimed, workflow, T0 + 100).status).toBe('running');
  });

  it('leaves the run open while a human decision is pending', () => {
    const { workflow, run } = build([step({ id: 'gate', requiresApproval: true })]);
    expect(finalise(awaitApproval(run, 'gate', T0), workflow, T0 + 100).status).toBe('running');
  });

  it('succeeds once every step resolved', () => {
    const { workflow, run } = chain();
    let state = runStep(run, 'a', null, T0);
    state = runStep(state, 'b', null, T0 + 1_000);
    state = runStep(state, 'c', null, T0 + 2_000);
    const done = finalise(state, workflow, T0 + 3_000);
    expect(done.status).toBe('succeeded');
    expect(done.finishedAt).toBe(T0 + 3_000);
  });

  it('fails the run and closes the blocked tail when a step fails', () => {
    const { workflow, run } = chain();
    const lease = take(null, 'runner:1', T0);
    let state = markClaimed(run, 'a', lease, T0);
    state = failStep(state, {
      stepId: 'a',
      owner: 'runner:1',
      fenceToken: lease.fenceToken,
      error: 'provider down',
      at: T0 + 100,
    });
    const done = finalise(state, workflow, T0 + 200);
    expect(done.status).toBe('failed');
    expect(done.steps.get('b')?.status).toBe('skipped');
    expect(done.steps.get('c')?.status).toBe('skipped');
  });

  it('succeeds when the only unfinished steps were skipped branches', () => {
    const { workflow, run } = chain();
    let state = runStep(run, 'a', null, T0);
    state = skipStep(state, 'b', 'condition false', T0 + 1_000);
    state = runStep(state, 'c', null, T0 + 2_000);
    expect(finalise(state, workflow, T0 + 3_000).status).toBe('succeeded');
  });

  it('is a no-op on an already-finished run', () => {
    const { workflow, run } = chain();
    const cancelled = cancelRun(run, workflow, { reason: 'x', by: 'ops', at: T0 });
    expect(finalise(cancelled, workflow, T0 + 1)).toBe(cancelled);
  });
});

describe('determinism', () => {
  it('produces an identical state and trace for an identical sequence', () => {
    // The property replay rests on.
    const replay = () => {
      const { workflow, run } = chain();
      let state = runStep(run, 'a', { price: 42 }, T0);
      state = runStep(state, 'b', { ok: true }, T0 + 1_000);
      state = runStep(state, 'c', null, T0 + 2_000);
      return finalise(state, workflow, T0 + 3_000);
    };
    expect(JSON.stringify(replay().trace)).toBe(JSON.stringify(replay().trace));
  });
});
