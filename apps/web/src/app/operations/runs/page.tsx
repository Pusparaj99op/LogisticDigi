'use client';

import { useEffect, useState } from 'react';
import { Empty, Eyebrow, Figure, FloorPanel, Marker, type Tone } from '@/components/primitives';
import { useRuns, useRunSteps, useRunTrace } from '@/components/live';
import { useSession } from '@/lib/auth-context';

/**
 * The audit trail.
 *
 * The sign-in page promises "full trace — replayable, and not editable by
 * us", and `firebase/firestore.rules` backs that with `allow write: if false`
 * on every trace document. This screen is where that promise is actually
 * kept: the orchestrator writes the trail, and here a person reads it.
 *
 * A master-detail rather than a `/runs/[runId]` route because apps/web is a
 * static export (see next.config.ts) — a dynamic segment would need every run
 * id known at build time, which is exactly what a live run id is not.
 */

const RUN_TONE: Record<string, Tone> = {
  running: 'hazard',
  paused: 'neutral',
  succeeded: 'clear',
  failed: 'refused',
  cancelled: 'neutral',
};

const STEP_TONE: Record<string, Tone> = {
  pending: 'neutral',
  ready: 'neutral',
  running: 'hazard',
  awaiting_approval: 'hazard',
  succeeded: 'clear',
  failed: 'refused',
  skipped: 'neutral',
  cancelled: 'neutral',
};

/**
 * Trace events that mean a person, or a guard, stopped something. These get
 * the hazard colour; everything else stays quiet, so the trail reads at a
 * glance rather than being a uniform wall of entries.
 */
const TRACE_TONE: Record<string, Tone> = {
  run_created: 'neutral',
  step_claimed: 'neutral',
  step_started: 'neutral',
  step_succeeded: 'clear',
  step_failed: 'refused',
  step_skipped: 'neutral',
  step_awaiting_approval: 'hazard',
  step_approved: 'clear',
  step_rejected: 'refused',
  commit_refused: 'refused',
  run_paused: 'hazard',
  run_resumed: 'neutral',
  run_cancelled: 'refused',
  run_finished: 'clear',
};

function when(at: number | null): string {
  return at === null ? '—' : new Date(at).toLocaleTimeString();
}

export default function RunsPage() {
  const session = useSession();
  const runs = useRuns(session.tenantId, 50);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && runs.items.length > 0) setSelectedId(runs.items[0]?.id ?? null);
  }, [runs.items, selectedId]);

  const steps = useRunSteps(selectedId);
  const trace = useRunTrace(selectedId);
  const selected = runs.items.find((entry) => entry.id === selectedId) ?? null;

  // Steps carry no intrinsic order in Firestore; the trace does. Ordering by
  // first appearance in the trail reproduces execution order without needing
  // the compiled workflow's topological order on the client.
  const stepOrder = new Map<string, number>();
  for (const event of trace.items) {
    if (event.stepId && !stepOrder.has(event.stepId)) stepOrder.set(event.stepId, stepOrder.size);
  }
  const orderedSteps = [...steps.items].sort(
    (a, b) => (stepOrder.get(a.stepId) ?? 999) - (stepOrder.get(b.stepId) ?? 999),
  );

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Runs</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">What the agents actually did</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-chalk-soft)]">
          Every step, in order, and every action a guard refused. Written by the orchestrator and
          read-only to everyone — including us.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[20rem_1fr]">
        <FloorPanel title="Runs">
          {!runs.ready ? (
            <Empty>Connecting to your workspace.</Empty>
          ) : runs.error ? (
            <Empty>Could not load runs: {runs.error}</Empty>
          ) : runs.items.length === 0 ? (
            <Empty>
              No runs yet. When you give the major agent a goal, its work appears here step by step.
            </Empty>
          ) : (
            <ul className="max-h-[32rem] overflow-y-auto">
              {runs.items.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(run.id)}
                    className={`block w-full border-b border-[var(--color-seam)] px-4 py-3 text-left transition-colors last:border-b-0 ${
                      run.id === selectedId
                        ? 'bg-[var(--color-steel-raised)]'
                        : 'hover:bg-[var(--color-steel-raised)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-[var(--color-chalk)]">{run.goal}</span>
                      <Marker tone={RUN_TONE[run.status] ?? 'neutral'}>{run.status}</Marker>
                    </div>
                    <Figure className="mt-0.5 block truncate text-xs text-[var(--color-chalk-faint)]">
                      {run.id}
                    </Figure>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FloorPanel>

        <div className="min-w-0 space-y-6">
          <FloorPanel title="Steps">
            {!selected ? (
              <Empty>Select a run to see what it did.</Empty>
            ) : !steps.ready ? (
              <Empty>Loading steps.</Empty>
            ) : steps.error ? (
              <Empty>Could not load steps: {steps.error}</Empty>
            ) : orderedSteps.length === 0 ? (
              <Empty>This run recorded no steps.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-seam)]">
                      {['Step', 'Status', 'Attempt', 'Started', 'Finished', 'Why'].map((heading) => (
                        <th key={heading} className="eyebrow px-4 py-3 text-left font-normal">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedSteps.map((step) => (
                      <tr
                        key={step.id}
                        className="border-b border-[var(--color-seam)] last:border-b-0"
                      >
                        <td className="px-4 py-3">
                          <Figure className="text-[var(--color-chalk)]">{step.stepId}</Figure>
                        </td>
                        <td className="px-4 py-3">
                          <Marker tone={STEP_TONE[step.status] ?? 'neutral'}>{step.status}</Marker>
                        </td>
                        <td className="tabular px-4 py-3 text-[var(--color-chalk-faint)]">
                          {step.attempt}
                        </td>
                        <td className="tabular px-4 py-3 text-[var(--color-chalk-faint)]">
                          {when(step.startedAt)}
                        </td>
                        <td className="tabular px-4 py-3 text-[var(--color-chalk-faint)]">
                          {when(step.completedAt)}
                        </td>
                        <td className="max-w-md px-4 py-3 text-xs text-[var(--color-chalk-soft)]">
                          {step.error ?? step.skipReason ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FloorPanel>

          <FloorPanel title="Trace">
            {!selected ? (
              <Empty>Select a run to read its trail.</Empty>
            ) : !trace.ready ? (
              <Empty>Loading the trail.</Empty>
            ) : trace.error ? (
              <Empty>Could not load the trace: {trace.error}</Empty>
            ) : trace.items.length === 0 ? (
              <Empty>No trace events recorded for this run.</Empty>
            ) : (
              <ol className="max-h-[36rem] overflow-y-auto p-4">
                {trace.items.map((event) => (
                  <li
                    key={event.id}
                    className="border-l-2 border-[var(--color-seam)] py-2 pl-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Figure className="text-xs text-[var(--color-chalk-faint)]">
                        {String(event.seq).padStart(3, '0')}
                      </Figure>
                      <Marker tone={TRACE_TONE[event.type] ?? 'neutral'}>{event.type}</Marker>
                      <span className="tabular text-xs text-[var(--color-chalk-faint)]">
                        {when(event.at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-chalk-soft)]">{event.summary}</p>
                  </li>
                ))}
              </ol>
            )}
          </FloorPanel>
        </div>
      </div>
    </div>
  );
}
