/**
 * Picks the next demo run.
 *
 * There is no LLM planner in this repo yet (see packages/agents — capability
 * scopes exist, a planner does not), so a live run's workflow comes from the
 * eval suite's scenarios: the same specs, seeds, and fleets the eval harness
 * already validated against the guarded executor. That is a deliberate
 * choice, not a shortcut — running anything the eval has not exercised would
 * mean the dashboard could show a state the guards were never checked
 * against.
 */

import { compileWorkflow, type CompiledWorkflow } from '@logisticdigi/core';
import { SCENARIOS, World, type Scenario } from '@logisticdigi/eval';

/** Two demo tenants so the console has more than one workspace to show. */
export const DEMO_TENANTS: readonly string[] = ['tenant_a', 'tenant_b'];

let cursor = 0;

/** Round-robins the suite rather than randomising it, so a run of the
 * orchestrator is reproducible run-to-run for a given start index. */
export function nextScenario(): Scenario {
  const scenario = SCENARIOS[cursor % SCENARIOS.length] as Scenario;
  cursor += 1;
  return scenario;
}

export function tenantFor(scenario: Scenario, index: number): string {
  void scenario;
  return DEMO_TENANTS[index % DEMO_TENANTS.length] as string;
}

export interface DemoRun {
  readonly runId: string;
  readonly tenantId: string;
  readonly scenario: Scenario;
  readonly workflow: CompiledWorkflow;
  readonly world: World;
}

/** Build a fresh, independent World and compiled workflow for one run. */
export function startDemoRun(now: number, index: number): DemoRun {
  const scenario = nextScenario();
  const tenantId = tenantFor(scenario, index);
  const runId = `run_${scenario.id}_${now.toString(36)}_${index.toString(36)}`;

  const workflow = compileWorkflow({ ...scenario.spec, id: runId, tenantId });
  const world = new World({
    seed: scenario.seed + index,
    budgetCap: scenario.budgetCap,
    ...(scenario.approvalThreshold ? { approvalThreshold: scenario.approvalThreshold } : {}),
    now,
    providers: scenario.providers,
  });

  return { runId, tenantId, scenario, workflow, world };
}
