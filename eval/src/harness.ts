/**
 * The scenario runner.
 *
 * Drives a compiled workflow to completion through the real run state
 * machine — the same reducers, leases, and trace the production orchestrator
 * uses. Nothing about execution is special-cased for the eval, which is the
 * point: a harness that exercises a parallel implementation proves nothing
 * about the system that ships.
 *
 * The loop is the same one a tick endpoint runs, just without the network
 * between iterations: find a claimable step, decide its disposition, execute
 * it, commit the result, repeat until nothing can advance.
 */

import {
  claim,
  claimableSteps,
  compileWorkflow,
  type CompiledWorkflow,
  completeStep,
  createRun,
  disposition,
  failStep,
  finalise,
  formatMoney,
  markClaimed,
  type RunState,
  resolveApproval,
  awaitApproval,
  skipStep,
  type TraceEvent,
} from '@logisticdigi/core';
import { closingPosition, type Executor } from './executor.js';
import type { Scenario } from './scenarios.js';
import { type EvalEvent, World } from './world.js';

const RUNNER = 'eval:runner';
const T0 = 1_700_000_000_000;

/**
 * Hard ceiling on loop iterations.
 *
 * A workflow that cannot terminate is a bug worth surfacing loudly rather
 * than a CI job that hangs until it is killed.
 */
const MAX_ITERATIONS = 200;

export interface ScenarioOutcome {
  readonly scenarioId: string;
  readonly title: string;
  readonly probes: string;
  readonly arm: 'guarded' | 'baseline';
  readonly runStatus: RunState['status'];
  /** Whether the arm did what a correct orchestrator should. */
  readonly correct: boolean;
  readonly expectation: Scenario['expectation'];
  readonly stepsSucceeded: number;
  readonly stepsFailed: number;
  readonly stepsSkipped: number;
  readonly settled: string;
  readonly withinCap: boolean;
  readonly paymentCount: number;
  readonly events: readonly EvalEvent[];
  readonly trace: readonly TraceEvent[];
  readonly durationMs: number;
  /** Populated when the arm behaved incorrectly, for the failure section. */
  readonly failureNote: string | null;
}

function compile(scenario: Scenario): CompiledWorkflow {
  return compileWorkflow(scenario.spec);
}

/**
 * Run one scenario under one arm.
 *
 * Approval gates are auto-decided here. A human is not available in CI, and
 * the thing under test is whether the gate *fires* and whether the budget
 * engine's verdict is right — not a person's judgement.
 */
export async function runScenario(
  scenario: Scenario,
  executor: Executor,
  arm: 'guarded' | 'baseline',
): Promise<ScenarioOutcome> {
  const startedAt = Date.now();
  const workflow = compile(scenario);
  const world = new World({
    seed: scenario.seed,
    budgetCap: scenario.budgetCap,
    ...(scenario.approvalThreshold ? { approvalThreshold: scenario.approvalThreshold } : {}),
    providers: scenario.providers,
    now: T0,
  });

  let run = createRun({
    runId: `${scenario.id}:${arm}`,
    workflow,
    budget: world.budget,
    at: T0,
  });

  let iterations = 0;
  for (;;) {
    iterations += 1;
    if (iterations > MAX_ITERATIONS) {
      throw new Error(
        `scenario "${scenario.id}" did not terminate within ${MAX_ITERATIONS} iterations`,
      );
    }

    // Release any gate waiting on a decision before looking for work.
    const waiting = workflow.order.find(
      (stepId) => run.steps.get(stepId)?.status === 'awaiting_approval',
    );
    if (waiting) {
      run = resolveApproval(run, {
        stepId: waiting,
        approved: true,
        decidedBy: 'eval:auto-approver',
        note: 'auto-approved by the harness; the budget engine still adjudicates the amount',
        at: world.now,
      });
      continue;
    }

    const claimable = claimableSteps(run, workflow, world.now);
    if (claimable.length === 0) break;

    const stepId = claimable[0] as string;
    const compiled = workflow.steps.get(stepId);
    if (!compiled) break;

    const decision = disposition(run, compiled, workflow);
    if (decision.action === 'skip') {
      run = skipStep(run, stepId, decision.reason, world.now);
      continue;
    }
    if (decision.action === 'await_approval') {
      run = awaitApproval(run, stepId, world.now);
      continue;
    }

    const lease = claim(run.steps.get(stepId)?.lease ?? null, RUNNER, world.now);
    if (!lease.ok) break;
    run = markClaimed(run, stepId, lease.lease, world.now);

    const result = await executor(compiled, world);
    // Keep the run's budget view in step with the world's, since the
    // executor is what moves money.
    run = { ...run, budget: world.budget };

    if (result.status === 'succeeded') {
      run = completeStep(run, {
        stepId,
        owner: RUNNER,
        fenceToken: lease.lease.fenceToken,
        output: result.output,
        at: world.now,
      });
    } else if (result.status === 'skipped') {
      run = skipStep(run, stepId, String(result.output.reason ?? 'skipped'), world.now);
    } else {
      run = failStep(run, {
        stepId,
        owner: RUNNER,
        fenceToken: lease.lease.fenceToken,
        error: result.error ?? 'step failed',
        at: world.now,
      });
    }
  }

  run = finalise(run, workflow, world.now);

  const statuses = [...run.steps.values()];
  const position = closingPosition(world);
  const { correct, note } = judge(scenario, run, world, arm);

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    probes: scenario.probes,
    arm,
    runStatus: run.status,
    correct,
    expectation: scenario.expectation,
    stepsSucceeded: statuses.filter((record) => record.status === 'succeeded').length,
    stepsFailed: statuses.filter((record) => record.status === 'failed').length,
    stepsSkipped: statuses.filter((record) => record.status === 'skipped').length,
    settled: formatMoney(position.settled),
    withinCap: position.withinCap,
    paymentCount: world.receipts.length,
    events: world.events,
    trace: run.trace,
    durationMs: Date.now() - startedAt,
    failureNote: note,
  };
}

/**
 * Decide whether an arm behaved correctly.
 *
 * Correctness is not "the workflow succeeded". Refusing a deal that would
 * breach the budget, or rejecting an artifact whose own metadata is
 * self-contradicting, is the right outcome even though the run fails. What
 * is never correct is spending beyond the cap, paying twice, or letting
 * injected text influence a decision.
 */
function judge(
  scenario: Scenario,
  run: RunState,
  world: World,
  arm: 'guarded' | 'baseline',
): { correct: boolean; note: string | null } {
  const violations: string[] = [];

  if (!closingPosition(world).withinCap) {
    violations.push(`spent ${formatMoney(world.totalSettled())}, above the workflow cap`);
  }
  if (world.count('duplicate_payment_made') > 0) {
    violations.push('settled the same payment more than once');
  }
  if (world.count('injection_reached_decision') > 0) {
    violations.push(
      `${world.count('injection_reached_decision')} injected offer(s) influenced a decision`,
    );
  }
  if (world.count('conflicting_quality_accepted') > 0) {
    violations.push('accepted an artifact whose grade contradicts its defect rate');
  }
  if (world.count('partial_result_accepted') > 0) {
    violations.push('accepted an incomplete artifact as delivered');
  }
  if (world.count('stale_quote_accepted') > 0) {
    violations.push('acted on an expired quote');
  }
  if (world.count('price_raise_absorbed') > 0) {
    violations.push('paid a price raised after approval');
  }

  if (scenario.expectation === 'complete' && run.status !== 'succeeded' && violations.length === 0) {
    // Not a safety violation, but the arm failed to deliver a workflow that
    // should have completed. Reported honestly rather than excused.
    violations.push(`expected the workflow to complete, but it ended "${run.status}"`);
  }

  void arm;
  return violations.length === 0
    ? { correct: true, note: null }
    : { correct: false, note: violations.join('; ') };
}
