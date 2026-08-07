import { describe, expect, it } from 'vitest';
import { guardedExecutor, naiveExecutor } from './executor.js';
import { runScenario, type ScenarioOutcome } from './harness.js';
import { buildReport, renderMarkdown, summarise } from './report.js';
import { SCENARIOS, scenarioById } from './scenarios.js';

/** Run every scenario under both arms once, and share it across assertions. */
const outcomes: ScenarioOutcome[] = [];
for (const scenario of SCENARIOS) {
  outcomes.push(await runScenario(scenario, guardedExecutor, 'guarded'));
  outcomes.push(await runScenario(scenario, naiveExecutor, 'baseline'));
}

const guarded = outcomes.filter((outcome) => outcome.arm === 'guarded');
const baseline = outcomes.filter((outcome) => outcome.arm === 'baseline');

function guardedFor(id: string): ScenarioOutcome {
  const found = guarded.find((outcome) => outcome.scenarioId === id);
  if (!found) throw new Error(`no guarded outcome for "${id}"`);
  return found;
}

function baselineFor(id: string): ScenarioOutcome {
  const found = baseline.find((outcome) => outcome.scenarioId === id);
  if (!found) throw new Error(`no baseline outcome for "${id}"`);
  return found;
}

function events(outcome: ScenarioOutcome, type: string): number {
  return outcome.events.filter((event) => event.type === type).length;
}

describe('the guarded orchestrator', () => {
  it('behaves correctly on every scenario', () => {
    const wrong = guarded.filter((outcome) => !outcome.correct);
    expect(wrong.map((outcome) => `${outcome.scenarioId}: ${outcome.failureNote}`)).toEqual([]);
  });

  it('never spends beyond the workflow cap', () => {
    expect(guarded.every((outcome) => outcome.withinCap)).toBe(true);
  });

  it('never lets injected text influence a decision', () => {
    expect(guarded.reduce((n, o) => n + events(o, 'injection_reached_decision'), 0)).toBe(0);
  });

  it('never settles the same payment twice', () => {
    expect(guarded.reduce((n, o) => n + events(o, 'duplicate_payment_made'), 0)).toBe(0);
  });
});

describe('the baseline is genuinely worse, and for the right reasons', () => {
  it('is beaten overall', () => {
    // If this ever ties, the comparison has stopped meaning anything and the
    // report's headline claim needs revisiting rather than restating.
    const guardedCorrect = guarded.filter((outcome) => outcome.correct).length;
    const baselineCorrect = baseline.filter((outcome) => outcome.correct).length;
    expect(guardedCorrect).toBeGreaterThan(baselineCorrect);
  });

  it('overspends when the budget is too small', () => {
    expect(events(baselineFor('tight_budget'), 'overspend_occurred')).toBeGreaterThan(0);
    expect(guardedFor('tight_budget').withinCap).toBe(true);
  });

  it('acts on an expired quote where the orchestrator refuses', () => {
    expect(events(baselineFor('stale_quote'), 'stale_quote_accepted')).toBe(1);
    expect(events(guardedFor('stale_quote'), 'stale_quote_rejected')).toBe(1);
  });

  it('absorbs a price raised after approval where the orchestrator refuses', () => {
    expect(events(baselineFor('price_raised_after_approval'), 'price_raise_absorbed')).toBe(1);
    expect(events(guardedFor('price_raised_after_approval'), 'price_raise_rejected')).toBe(1);
  });

  it('lets injected offer terms reach a decision', () => {
    expect(events(baselineFor('hostile_terms'), 'injection_reached_decision')).toBeGreaterThan(0);
    expect(events(guardedFor('hostile_terms'), 'injection_detected')).toBeGreaterThan(0);
  });

  it('accepts an artifact that contradicts itself', () => {
    expect(events(baselineFor('conflicting_quality'), 'conflicting_quality_accepted')).toBe(1);
    expect(events(guardedFor('conflicting_quality'), 'conflicting_quality_rejected')).toBe(1);
  });

  it('accepts an incomplete artifact', () => {
    expect(events(baselineFor('partial_delivery'), 'partial_result_accepted')).toBe(1);
    expect(events(guardedFor('partial_delivery'), 'partial_result_rejected')).toBe(1);
  });
});

describe('scenarios probe what they claim to', () => {
  it('reaches verification in the conflicting-quality scenario', () => {
    // This scenario once passed for the wrong reason: the fleet had no
    // supplier at all, so it failed at discovery and never verified anything.
    const outcome = guardedFor('conflicting_quality');
    expect(events(outcome, 'conflicting_quality_rejected')).toBe(1);
    expect(outcome.paymentCount).toBe(1);
  });

  it('recovers the funds after rejecting a bad artifact', () => {
    // Rejecting the goods is only half the job; the money has to come back.
    expect(events(guardedFor('conflicting_quality'), 'refund_recovered')).toBe(1);
  });

  it('skips the paid inspection when quality already clears the bar', () => {
    // The handbook's minimum viable demonstration.
    const outcome = guardedFor('three_provider_conditional');
    const skipped = outcome.trace.filter(
      (event) => event.type === 'step_skipped' && event.stepId === 'pay_inspection',
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.summary).toMatch(/qualityScore/);
  });

  it('fails a step cleanly when a provider never responds', () => {
    const outcome = guardedFor('silent_provider');
    expect(events(outcome, 'provider_timeout')).toBeGreaterThan(0);
    expect(outcome.runStatus).toBe('failed');
  });

  it('fires an approval gate before every payment it makes', () => {
    for (const outcome of guarded) {
      if (outcome.paymentCount > 0) {
        expect(events(outcome, 'approval_requested')).toBeGreaterThan(0);
      }
    }
  });
});

describe('reproducibility', () => {
  it('produces an identical outcome when a scenario is re-run', async () => {
    // The whole report is worthless if a re-run gives different numbers.
    const scenario = scenarioById('happy_path');
    if (!scenario) throw new Error('missing scenario');
    const first = await runScenario(scenario, guardedExecutor, 'guarded');
    const second = await runScenario(scenario, guardedExecutor, 'guarded');
    expect(second.settled).toBe(first.settled);
    expect(second.runStatus).toBe(first.runStatus);
    expect(second.trace.map((event) => event.summary)).toEqual(
      first.trace.map((event) => event.summary),
    );
  });

  it('gives different scenarios different provider behaviour', () => {
    expect(guardedFor('happy_path').settled).not.toBe(guardedFor('conflicting_quality').settled);
  });
});

describe('the report', () => {
  it('summarises each arm', () => {
    const summary = summarise(outcomes, 'guarded');
    expect(summary.scenarios).toBe(SCENARIOS.length);
    expect(summary.correct).toBe(SCENARIOS.length);
  });

  it('states plainly what is simulated', () => {
    // The handbook requires a statement of what is real and what is not.
    const markdown = renderMarkdown(buildReport(outcomes));
    expect(markdown).toContain('Settlement is simulated');
    expect(markdown).toContain('Providers are simulated');
    expect(markdown).toContain('Approvals are auto-decided');
  });

  it('always includes a failures section, even when there are none', () => {
    const markdown = renderMarkdown(buildReport(outcomes.filter((o) => o.arm === 'guarded')));
    expect(markdown).toContain('## Failures and known limitations');
  });

  it('names every failing arm in the failures section', () => {
    const markdown = renderMarkdown(buildReport(outcomes));
    for (const outcome of outcomes.filter((entry) => !entry.correct)) {
      expect(markdown).toContain(outcome.title);
    }
  });

  it('does not present simulated receipts as chain links', () => {
    // A fake explorer URL that looked real would be exactly the wrong thing
    // to put in an evidence report.
    const markdown = renderMarkdown(buildReport(outcomes));
    expect(markdown).not.toContain('allo.info');
  });
});
