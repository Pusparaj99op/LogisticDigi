/**
 * Evaluation CLI.
 *
 *   pnpm eval                    run every scenario, both arms
 *   pnpm eval -- --scenario=id   run one scenario
 *   pnpm eval -- --json          write JSON alongside the Markdown
 *
 * Exits non-zero when the guarded arm violates a safety property, so CI
 * fails on a regression rather than quietly publishing a worse report.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardedExecutor, naiveExecutor } from './executor.js';
import { runScenario, type ScenarioOutcome } from './harness.js';
import { buildReport, renderMarkdown } from './report.js';
import { SCENARIOS, scenarioById } from './scenarios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'out');

function flag(name: string): string | undefined {
  const match = process.argv.find((argument) => argument.startsWith(`--${name}`));
  if (!match) return undefined;
  const [, value] = match.split('=');
  return value ?? '';
}

async function main(): Promise<void> {
  const only = flag('scenario');
  const scenarios = only
    ? [scenarioById(only)].filter((scenario) => scenario !== undefined)
    : SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`no scenario matched "${only}"`);
    console.error(`known scenarios: ${SCENARIOS.map((s) => s.id).join(', ')}`);
    process.exit(2);
  }

  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of scenarios) {
    for (const [arm, executor] of [
      ['guarded', guardedExecutor],
      ['baseline', naiveExecutor],
    ] as const) {
      const outcome = await runScenario(scenario, executor, arm);
      outcomes.push(outcome);
      const mark = outcome.correct ? 'ok  ' : 'FAIL';
      console.log(
        `${mark} ${scenario.id.padEnd(28)} ${arm.padEnd(9)} ` +
          `${outcome.runStatus.padEnd(10)} settled ${outcome.settled}`,
      );
      if (!outcome.correct) console.log(`       ${outcome.failureNote}`);

      if (flag('trace') !== undefined) {
        for (const event of outcome.trace) {
          console.log(
            `       ${String(event.seq).padStart(3)} ${event.type.padEnd(22)} ${event.summary}`,
          );
        }
        for (const event of outcome.events) {
          console.log(`       [${event.type}] ${event.stepId}: ${event.detail}`);
        }
      }
    }
  }

  const report = buildReport(outcomes);
  const markdown = renderMarkdown(report);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'report.md'), markdown, 'utf8');
  if (flag('json') !== undefined) {
    await writeFile(
      join(OUT_DIR, 'report.json'),
      JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
      'utf8',
    );
  }

  console.log('');
  console.log(`guarded : ${report.guarded.correct}/${report.guarded.scenarios} correct`);
  console.log(`baseline: ${report.baseline.correct}/${report.baseline.scenarios} correct`);
  console.log(`report written to ${join(OUT_DIR, 'report.md')}`);

  // Only the guarded arm gates CI. The baseline is expected to fail — that
  // is what it is for — so failing the build on it would be nonsense.
  const guardedFailures = outcomes.filter(
    (outcome) => outcome.arm === 'guarded' && !outcome.correct,
  );
  if (guardedFailures.length > 0) {
    console.error('');
    console.error(`${guardedFailures.length} guarded scenario(s) behaved incorrectly:`);
    for (const failure of guardedFailures) {
      console.error(`  - ${failure.scenarioId}: ${failure.failureNote}`);
    }
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
