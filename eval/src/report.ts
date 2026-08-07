/**
 * Report generation.
 *
 * Produces a Markdown table a judge can read and a JSON file a script can
 * diff between runs. Both include the failure section unconditionally: the
 * handbook says submissions reporting only selected successes may be
 * downgraded even when the demo is strong, so "no failures" has to be
 * something the report can *say*, not something it achieves by omission.
 */

import type { EvalEventType } from './world.js';
import type { ScenarioOutcome } from './harness.js';

export interface ArmSummary {
  readonly arm: 'guarded' | 'baseline';
  readonly scenarios: number;
  readonly correct: number;
  readonly completed: number;
  readonly overspends: number;
  readonly duplicatePayments: number;
  readonly injectionsReachingDecisions: number;
  readonly injectionsDetected: number;
  readonly staleQuotesAccepted: number;
  readonly badArtifactsAccepted: number;
  readonly priceRaisesAbsorbed: number;
  readonly approvalsRequested: number;
  readonly totalPayments: number;
}

function tally(outcomes: readonly ScenarioOutcome[], type: EvalEventType): number {
  return outcomes.reduce(
    (total, outcome) => total + outcome.events.filter((event) => event.type === type).length,
    0,
  );
}

export function summarise(
  outcomes: readonly ScenarioOutcome[],
  arm: 'guarded' | 'baseline',
): ArmSummary {
  const mine = outcomes.filter((outcome) => outcome.arm === arm);
  return {
    arm,
    scenarios: mine.length,
    correct: mine.filter((outcome) => outcome.correct).length,
    completed: mine.filter((outcome) => outcome.runStatus === 'succeeded').length,
    overspends: tally(mine, 'overspend_occurred'),
    duplicatePayments: tally(mine, 'duplicate_payment_made'),
    injectionsReachingDecisions: tally(mine, 'injection_reached_decision'),
    injectionsDetected: tally(mine, 'injection_detected'),
    staleQuotesAccepted: tally(mine, 'stale_quote_accepted'),
    badArtifactsAccepted:
      tally(mine, 'conflicting_quality_accepted') + tally(mine, 'partial_result_accepted'),
    priceRaisesAbsorbed: tally(mine, 'price_raise_absorbed'),
    approvalsRequested: tally(mine, 'approval_requested'),
    totalPayments: mine.reduce((total, outcome) => total + outcome.paymentCount, 0),
  };
}

export interface EvalReport {
  readonly generatedAt: string;
  readonly seedNote: string;
  readonly guarded: ArmSummary;
  readonly baseline: ArmSummary;
  readonly outcomes: readonly ScenarioOutcome[];
}

export function buildReport(outcomes: readonly ScenarioOutcome[]): EvalReport {
  return {
    generatedAt: new Date().toISOString(),
    seedNote:
      'Every scenario is seeded. Re-running this suite on any machine produces the same ' +
      'provider behaviour, the same offers, and the same decisions.',
    guarded: summarise(outcomes, 'guarded'),
    baseline: summarise(outcomes, 'baseline'),
    outcomes,
  };
}

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.join(' | ')} |`;
}

export function renderMarkdown(report: EvalReport): string {
  const { guarded, baseline } = report;
  const lines: string[] = [];

  lines.push('# LogisticDigi evaluation report');
  lines.push('');
  lines.push(`Generated ${report.generatedAt}`);
  lines.push('');
  lines.push('## What this measures');
  lines.push('');
  lines.push(
    'Both arms run the identical workflows against the identical seeded provider fleet. ' +
      'The **guarded** arm is the orchestrator: budget reserve/settle, injection screening, ' +
      'quote-expiry checks, fulfilment verification, and approval gates. The **baseline** ' +
      'calls the same services in the same order without a policy layer — a competent ' +
      'implementation that believes what providers tell it.',
  );
  lines.push('');
  lines.push(
    'No language model is involved in either arm. The eval measures the harness — the ' +
      'orchestration, policy, and verification code — so the numbers hold regardless of ' +
      'which model drives it in production.',
  );
  lines.push('');
  lines.push(report.seedNote);
  lines.push('');

  lines.push('## Headline comparison');
  lines.push('');
  lines.push(row(['Metric', 'Guarded', 'Baseline', 'Better']));
  lines.push(row(['---', '---', '---', '---']));

  const comparisons: readonly (readonly [string, number, number, 'lower' | 'higher'])[] = [
    ['Scenarios behaving correctly', guarded.correct, baseline.correct, 'higher'],
    ['Workflows completed', guarded.completed, baseline.completed, 'higher'],
    ['Budget overspends', guarded.overspends, baseline.overspends, 'lower'],
    ['Duplicate payments', guarded.duplicatePayments, baseline.duplicatePayments, 'lower'],
    [
      'Injections reaching a decision',
      guarded.injectionsReachingDecisions,
      baseline.injectionsReachingDecisions,
      'lower',
    ],
    ['Stale quotes acted on', guarded.staleQuotesAccepted, baseline.staleQuotesAccepted, 'lower'],
    ['Bad artifacts accepted', guarded.badArtifactsAccepted, baseline.badArtifactsAccepted, 'lower'],
    [
      'Price raises absorbed after approval',
      guarded.priceRaisesAbsorbed,
      baseline.priceRaisesAbsorbed,
      'lower',
    ],
    ['Approval gates fired', guarded.approvalsRequested, baseline.approvalsRequested, 'higher'],
  ];

  for (const [label, g, b, direction] of comparisons) {
    const better =
      g === b ? 'tie' : direction === 'lower' ? (g < b ? 'guarded' : 'baseline') : g > b ? 'guarded' : 'baseline';
    lines.push(row([label, g, b, better]));
  }

  lines.push('');
  lines.push(`Scenarios: ${guarded.scenarios}. Payments settled: guarded ${guarded.totalPayments}, baseline ${baseline.totalPayments}.`);
  lines.push('');

  lines.push('## Per-scenario results');
  lines.push('');
  lines.push(row(['Scenario', 'Probes', 'Arm', 'Run status', 'Settled', 'Correct']));
  lines.push(row(['---', '---', '---', '---', '---', '---']));
  for (const outcome of report.outcomes) {
    lines.push(
      row([
        outcome.title,
        outcome.probes,
        outcome.arm,
        outcome.runStatus,
        outcome.settled,
        outcome.correct ? 'yes' : 'NO',
      ]),
    );
  }
  lines.push('');

  lines.push('## Failures and known limitations');
  lines.push('');
  const failures = report.outcomes.filter((outcome) => !outcome.correct);
  if (failures.length === 0) {
    lines.push('No arm violated a safety property in this run.');
  } else {
    for (const outcome of failures) {
      lines.push(`- **${outcome.title}** (${outcome.arm}): ${outcome.failureNote}`);
    }
  }
  lines.push('');
  lines.push('### What is simulated');
  lines.push('');
  lines.push(
    '- **Settlement is simulated.** The eval uses an in-process settler that confirms ' +
      'instantly; receipts carry a `simulated://` URL rather than a chain explorer link. ' +
      'What is under test here is the facilitator ordering and nonce ledger, not Algorand. ' +
      'Real TestNet settlement is exercised separately.',
  );
  lines.push(
    '- **Providers are simulated.** A seeded fleet with named adversarial behaviours ' +
      '(stale quotes, price raised after approval, partial results, conflicting quality ' +
      'metadata, injected terms, silent timeout, refused refund).',
  );
  lines.push(
    '- **Approvals are auto-decided.** A human is not available in CI. What is tested is ' +
      'that the gate fires and that the budget engine adjudicates the amount correctly.',
  );
  lines.push('');

  return lines.join('\n');
}
