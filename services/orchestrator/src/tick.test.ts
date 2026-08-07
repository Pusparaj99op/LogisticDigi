import { describe, expect, it } from 'vitest';
import { compileWorkflow, createRun, parseAmount } from '@logisticdigi/core';
import { World } from '@logisticdigi/eval';
import { DEFAULT_FLEET } from '@logisticdigi/sim';
import { MemoryStore } from './memory-store.js';
import { driveRun, type LiveRun } from './tick.js';

const usdc = (amount: string) => parseAmount('USDC', amount);
const HONEST = DEFAULT_FLEET.filter((profile) => profile.behaviours.includes('honest'));

/** A minimal procurement workflow: discover -> quote -> negotiate -> approve -> pay -> verify. */
function buildLiveRun(now: number, approvalThreshold: string): { live: LiveRun; store: MemoryStore } {
  const workflow = compileWorkflow({
    id: 'run_test',
    tenantId: 'tenant_a',
    goal: 'test procurement',
    budget: usdc('500'),
    steps: [
      { id: 'discover_suppliers', kind: 'discover', role: 'procurement', description: 'discover' },
      {
        id: 'quote_supplier',
        kind: 'quote',
        role: 'procurement',
        description: 'quote',
        dependsOn: ['discover_suppliers'],
      },
      {
        id: 'negotiate_terms',
        kind: 'negotiate',
        role: 'negotiation',
        description: 'negotiate',
        dependsOn: ['quote_supplier'],
      },
      {
        id: 'approve_spend',
        kind: 'approve',
        role: 'compliance',
        description: 'approve',
        dependsOn: ['negotiate_terms'],
      },
      {
        id: 'pay_supplier',
        kind: 'pay',
        role: 'settlement',
        description: 'pay',
        dependsOn: ['approve_spend'],
        maxSpend: usdc('300'),
      },
      {
        id: 'verify_delivery',
        kind: 'verify',
        role: 'compliance',
        description: 'verify',
        dependsOn: ['pay_supplier'],
      },
    ],
  });

  const world = new World({
    seed: 1,
    budgetCap: usdc('500'),
    approvalThreshold: usdc(approvalThreshold),
    now,
    providers: HONEST,
  });
  const run = createRun({ runId: 'run_test', workflow, budget: world.budget, at: now });
  const store = new MemoryStore();
  return { live: { tenantId: 'tenant_a', workflow, world, run }, store };
}

describe('driveRun', () => {
  it('completes a run that never crosses the approval threshold', async () => {
    // Threshold above the workflow cap: nothing can ever require approval.
    const { live, store } = buildLiveRun(0, '10000');
    const run = await driveRun(store, 'test-runner', live, 0);

    expect(run.status).toBe('succeeded');
    expect(store.approvals.size).toBe(0);
    expect(store.ledger.some((entry) => entry.kind === 'settled')).toBe(true);
    expect(store.receipts).toHaveLength(1);
    const runDoc = store.runs.get('run_test');
    expect(runDoc?.status).toBe('succeeded');
    expect(Number(runDoc?.settledUnits)).toBeGreaterThan(0);
  });

  it('pauses at the approval gate and resumes once a human decides', async () => {
    // Threshold at zero: any positive spend requires approval.
    const { live, store } = buildLiveRun(0, '0');
    const paused = await driveRun(store, 'test-runner', live, 0);

    expect(paused.status).toBe('running');
    expect(paused.steps.get('approve_spend')?.status).toBe('awaiting_approval');
    expect(store.approvals.size).toBe(1);
    const approval = [...store.approvals.values()][0];
    expect(approval?.status).toBe('pending');
    expect(approval?.stepId).toBe('approve_spend');

    // Re-driving without a decision changes nothing: it is genuinely stuck
    // until a person acts.
    const stillPaused = await driveRun(store, 'test-runner', { ...live, run: paused }, 1_000);
    expect(stillPaused.steps.get('approve_spend')?.status).toBe('awaiting_approval');

    store.decide('run_test', 'approve_spend', true, 'operator-1');
    const resumed = await driveRun(store, 'test-runner', { ...live, run: stillPaused }, 2_000);

    expect(resumed.status).toBe('succeeded');
    expect(resumed.steps.get('approve_spend')?.status).toBe('succeeded');
    expect(store.ledger.some((entry) => entry.kind === 'settled')).toBe(true);
  });

  it('rejecting the approval skips the rest of the branch without paying', async () => {
    const { live, store } = buildLiveRun(0, '0');
    const paused = await driveRun(store, 'test-runner', live, 0);
    expect(store.approvals.size).toBe(1);

    store.decide('run_test', 'approve_spend', false, 'operator-1');
    const resolved = await driveRun(store, 'test-runner', { ...live, run: paused }, 1_000);

    expect(resolved.status).toBe('succeeded');
    expect(resolved.steps.get('approve_spend')?.status).toBe('skipped');
    expect(resolved.steps.get('pay_supplier')?.status).toBe('skipped');
    expect(store.ledger.some((entry) => entry.kind === 'settled')).toBe(false);
    expect(store.receipts).toHaveLength(0);
  });
});
