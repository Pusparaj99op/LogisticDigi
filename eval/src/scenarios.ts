/**
 * The evaluation task suite.
 *
 * Each scenario is a workflow specification plus a budget and a seed. The
 * seed selects which providers misbehave and how, so a scenario named
 * "stale quote" reliably produces one — reproducibly, on any machine, in CI.
 *
 * The suite deliberately includes scenarios the guarded orchestrator does
 * **not** fully win. A report showing 100% success on a hand-picked suite is
 * worth nothing; the handbook asks for at least one failure case and for
 * honest metrics, so the cases where a provider simply refuses to refund, or
 * never responds, are in here and are reported as failures.
 */

import { type Money, parseAmount, type WorkflowSpec, type WorkflowStepSpec } from '@logisticdigi/core';
import { DEFAULT_FLEET, type ProviderProfile } from '@logisticdigi/sim';

const usdc = (amount: string): Money => parseAmount('USDC', amount);

/** Pick named providers out of the default fleet. */
function fleetOf(...ids: readonly string[]): readonly ProviderProfile[] {
  return ids.map((id) => {
    const profile = DEFAULT_FLEET.find((entry) => entry.id === id);
    if (!profile) throw new Error(`unknown provider "${id}"`);
    return profile;
  });
}

/** Providers that behave. The control group for every adversarial scenario. */
const HONEST = fleetOf('sup_northwind', 'car_atlas', 'ins_verity');

/**
 * A supplier that misreports quality and does nothing else wrong.
 *
 * The stock hostile inspector also embeds prompt injection, so a scenario
 * built on it never reaches verification — the injection screen stops it at
 * the quote. Isolating the behaviour is the only way to measure the
 * verifier rather than accidentally re-measuring the scanner.
 */
const MISREPORTING_SUPPLIER: ProviderProfile = {
  id: 'sup_janus',
  name: 'Janus Consolidated',
  kind: 'supplier',
  behaviours: ['conflicting_quality'],
  basePrice: '230',
  reliability: 0.8,
};

/** A supplier that under-delivers documentation and nothing else. */
const INCOMPLETE_SUPPLIER: ProviderProfile = {
  id: 'sup_teal',
  name: 'Teal Provisioning',
  kind: 'supplier',
  behaviours: ['partial_result'],
  basePrice: '225',
  reliability: 0.7,
};

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** What this scenario is testing, in one line, for the report. */
  readonly probes: string;
  readonly seed: number;
  readonly budgetCap: Money;
  readonly approvalThreshold?: Money;
  /**
   * Which providers exist. A scenario is a seed *plus* a fleet composition:
   * to test stale-quote handling the stale-quote provider must be present,
   * and to test the ordinary path it must be absent.
   */
  readonly providers: readonly ProviderProfile[];
  readonly spec: WorkflowSpec;
  /**
   * What a correct orchestrator should do. Not always "succeed": refusing a
   * bad deal is the right outcome even though the workflow fails.
   */
  readonly expectation: 'complete' | 'refuse';
}

function step(overrides: Partial<WorkflowStepSpec> & { id: string }): WorkflowStepSpec {
  return {
    kind: 'discover',
    role: 'procurement',
    description: `step ${overrides.id}`,
    ...overrides,
  };
}

/** The standard procurement line: discover, quote, negotiate, approve, pay, verify. */
function procurementSpec(id: string, budget: Money, maxSpend: Money): WorkflowSpec {
  return {
    id,
    tenantId: 'tenant_a',
    goal: 'restock chilled cargo from the cheapest compliant supplier',
    budget,
    steps: [
      step({ id: 'discover_suppliers', kind: 'discover', role: 'procurement' }),
      step({
        id: 'quote_supplier',
        kind: 'quote',
        role: 'procurement',
        dependsOn: ['discover_suppliers'],
      }),
      step({
        id: 'negotiate_terms',
        kind: 'negotiate',
        role: 'negotiation',
        dependsOn: ['quote_supplier'],
      }),
      step({
        id: 'approve_spend',
        kind: 'approve',
        role: 'compliance',
        dependsOn: ['negotiate_terms'],
      }),
      step({
        id: 'pay_supplier',
        kind: 'pay',
        role: 'settlement',
        dependsOn: ['approve_spend'],
        maxSpend,
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
        maxSpend,
        // Only claim compensation when verification actually failed.
        when: { op: 'eq', ref: 'steps.verify_delivery.output.verified', value: false },
      }),
    ],
  };
}

/**
 * The handbook's minimum viable demonstration: three providers, one branch
 * skipped when a quality condition is already met.
 */
function threeProviderSpec(budget: Money): WorkflowSpec {
  return {
    id: 'wf_three_provider',
    tenantId: 'tenant_a',
    goal: 'source goods, arrange freight, and inspect only if quality is in doubt',
    budget,
    steps: [
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
      }),
      step({
        id: 'pay_supplier',
        kind: 'pay',
        role: 'settlement',
        dependsOn: ['approve_spend'],
        maxSpend: usdc('300'),
      }),
      // The conditional branch: a paid third-party inspection, skipped when
      // the negotiated quality already clears the bar.
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
      step({ id: 'track_shipment', kind: 'track', role: 'logistics', dependsOn: ['verify_delivery'] }),
    ],
  };
}

/** Swap one step's role, to route it at a different provider kind. */
function reroute(spec: WorkflowSpec, stepId: string, role: WorkflowStepSpec['role']): WorkflowSpec {
  return {
    ...spec,
    steps: spec.steps.map((entry) => (entry.id === stepId ? { ...entry, role } : entry)),
  };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'happy_path',
    title: 'Straightforward procurement',
    probes: 'the ordinary path completes and settles within budget',
    seed: 1,
    budgetCap: usdc('500'),
    approvalThreshold: usdc('250'),
    providers: HONEST,
    spec: procurementSpec('wf_happy', usdc('500'), usdc('300')),
    expectation: 'complete',
  },
  {
    id: 'three_provider_conditional',
    title: 'Three providers with a skippable branch',
    probes: 'conditional-edge correctness: the paid inspection is skipped when quality is met',
    seed: 7,
    budgetCap: usdc('500'),
    approvalThreshold: usdc('250'),
    providers: HONEST,
    spec: threeProviderSpec(usdc('500')),
    expectation: 'complete',
  },
  {
    id: 'tight_budget',
    title: 'Budget too small for the deal',
    probes: 'spend control: the orchestrator refuses rather than overspending',
    seed: 3,
    budgetCap: usdc('50'),
    approvalThreshold: usdc('25'),
    providers: HONEST,
    spec: procurementSpec('wf_tight', usdc('50'), usdc('45')),
    expectation: 'refuse',
  },
  {
    id: 'stale_quote',
    title: 'Supplier returns an already-expired quote',
    probes: 'an expired quote is refused rather than acted on',
    seed: 2,
    budgetCap: usdc('500'),
    approvalThreshold: usdc('250'),
    providers: fleetOf('sup_meridian', 'car_atlas', 'ins_verity'),
    spec: procurementSpec('wf_stale', usdc('500'), usdc('300')),
    expectation: 'refuse',
  },
  {
    id: 'price_raised_after_approval',
    title: 'Supplier raises its price after approval',
    probes: 'settlement is refused when the demand exceeds the approved amount',
    seed: 4,
    budgetCap: usdc('500'),
    approvalThreshold: usdc('250'),
    providers: fleetOf('sup_kestrel', 'car_atlas', 'ins_verity'),
    spec: procurementSpec('wf_raise', usdc('500'), usdc('300')),
    expectation: 'refuse',
  },
  {
    id: 'hostile_terms',
    title: 'Offer terms carrying a prompt injection',
    probes: 'untrusted text never reaches a decision',
    seed: 11,
    budgetCap: usdc('500'),
    approvalThreshold: usdc('400'),
    providers: fleetOf('sup_northwind', 'car_atlas', 'ins_hollow'),
    spec: reroute(
      procurementSpec('wf_hostile', usdc('500'), usdc('300')),
      'quote_supplier',
      'compliance',
    ),
    expectation: 'refuse',
  },
  {
    id: 'conflicting_quality',
    title: 'Artifact whose grade contradicts its defect rate',
    probes: 'verification catches self-contradicting metadata and the refund branch reclaims funds',
    seed: 13,
    budgetCap: usdc('500'),
    approvalThreshold: usdc('400'),
    providers: [MISREPORTING_SUPPLIER, ...fleetOf('car_atlas', 'ins_verity')],
    spec: procurementSpec('wf_conflicting', usdc('500'), usdc('300')),
    expectation: 'complete',
  },
  {
    id: 'partial_delivery',
    title: 'Supplier delivers incomplete documentation',
    probes: 'an artifact missing required fields is rejected and compensation is claimed',
    seed: 17,
    budgetCap: usdc('500'),
    approvalThreshold: usdc('400'),
    providers: [INCOMPLETE_SUPPLIER, ...fleetOf('car_atlas', 'ins_verity')],
    spec: procurementSpec('wf_partial', usdc('500'), usdc('300')),
    expectation: 'complete',
  },
  {
    id: 'silent_provider',
    title: 'Provider that never responds',
    probes: 'a timeout fails the step cleanly instead of hanging the workflow',
    seed: 5,
    budgetCap: usdc('500'),
    providers: fleetOf('sup_northwind', 'car_silt', 'ins_verity'),
    spec: reroute(
      procurementSpec('wf_silent', usdc('500'), usdc('300')),
      'quote_supplier',
      'logistics',
    ),
    expectation: 'refuse',
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
