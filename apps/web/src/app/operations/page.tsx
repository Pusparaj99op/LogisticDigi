'use client';

import Link from 'next/link';
import { formatMoney } from '@logisticdigi/core';
import { Document, Empty, Eyebrow, Figure, FloorPanel, HazardBar, Marker } from '@/components/primitives';
import { usePendingApprovals, useRuns } from '@/components/live';
import { useSession } from '@/lib/auth-context';
import { AgentMesh } from '@/components/agent-mesh';

function money(units: string | undefined, asset: string = 'USDC'): string {
  if (!units) return '—';
  return formatMoney({ asset: asset as 'USDC' | 'ALGO', units: BigInt(units) });
}

const RUN_TONE: Record<string, 'neutral' | 'hazard' | 'refused' | 'clear'> = {
  running: 'hazard',
  paused: 'neutral',
  succeeded: 'clear',
  failed: 'refused',
  cancelled: 'neutral',
};

export default function OperationsFloor() {
  const session = useSession();
  const runs = useRuns(session.tenantId);
  const approvals = usePendingApprovals(session.tenantId);

  const active = runs.items.filter((run) => run.status === 'running' || run.status === 'paused');

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Floor</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">Agent operations</h1>
      </div>

      {/*
        The hazard rule appears here only when a person is actually needed. On
        a quiet floor there is no marking at all, which is what makes its
        presence meaningful rather than ornamental.
      */}
      {approvals.items.length > 0 ? (
        <section>
          <HazardBar
            label={`${approvals.items.length} decision${
              approvals.items.length === 1 ? '' : 's'
            } waiting on you`}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {approvals.items.slice(0, 2).map((approval) => (
              <Document key={approval.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Eyebrow surface="paper">{approval.counterparty}</Eyebrow>
                    <p className="mt-1 text-sm text-[var(--color-ink)]">{approval.description}</p>
                  </div>
                  <Figure className="text-lg text-[var(--color-ink)]">
                    {money(approval.amountUnits, approval.asset)}
                  </Figure>
                </div>
                <p className="mt-3 text-xs text-[var(--color-ink-soft)]">{approval.reason}</p>
                <Link
                  href="/operations/approvals"
                  className="mt-4 inline-block text-sm text-[var(--color-ink)] underline underline-offset-4"
                >
                  Review this payment
                </Link>
              </Document>
            ))}
          </div>
          {approvals.items.length > 2 ? (
            <Link
              href="/operations/approvals"
              className="mt-3 inline-block text-sm text-[var(--color-chalk-soft)] underline underline-offset-4"
            >
              {approvals.items.length - 2} more waiting
            </Link>
          ) : null}
        </section>
      ) : null}

      <FloorPanel title="Agent network">
        <div className="p-4">
          <AgentMesh />
          <p className="mt-2 text-xs text-[var(--color-chalk-faint)]">
            Every line is a channel the agents can use to reach each other. Lit, dashed lines mark
            who is actually talking right now. Settlement also runs one real, honestly-separate
            wallet check via the Zerion API on every payment — see the Ledger for its result.
          </p>
        </div>
      </FloorPanel>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <FloorPanel title="Runs">
          {!runs.ready ? (
            <Empty>Connecting to your workspace.</Empty>
          ) : runs.error ? (
            <Empty>Could not load runs: {runs.error}</Empty>
          ) : runs.items.length === 0 ? (
            <Empty>
              No runs yet. When you give the major agent a goal, its work appears here step by
              step.
            </Empty>
          ) : (
            <ul>
              {runs.items.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center justify-between gap-4 border-b border-[var(--color-seam)] px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--color-chalk)]">{run.goal}</p>
                    <Figure className="text-xs text-[var(--color-chalk-faint)]">{run.id}</Figure>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <Figure className="text-sm text-[var(--color-chalk-soft)]">
                      {money(run.settledUnits)}
                    </Figure>
                    <Marker tone={RUN_TONE[run.status] ?? 'neutral'}>{run.status}</Marker>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FloorPanel>

        <div className="space-y-6">
          <FloorPanel title="Right now">
            <dl className="grid grid-cols-2 gap-px bg-[var(--color-seam)]">
              {[
                ['Active runs', String(active.length)],
                ['Waiting on you', String(approvals.items.length)],
              ].map(([term, value]) => (
                <div key={term} className="bg-[var(--color-steel)] px-4 py-5">
                  <dt className="eyebrow">{term}</dt>
                  <dd className="tabular mt-1 text-3xl text-[var(--color-chalk)]">{value}</dd>
                </div>
              ))}
            </dl>
          </FloorPanel>

          <FloorPanel title="What the agents may do">
            <div className="space-y-3 px-4 py-4 text-sm text-[var(--color-chalk-soft)]">
              <p>
                Settlement is the only agent that can move funds, and only up to the cap on each
                step.
              </p>
              <p>
                Compliance can stop any step outright. Nothing overrides it — not the major agent,
                not an approval.
              </p>
              <p>
                Payments above your threshold stop and wait for a person. That is the hazard
                marking above.
              </p>
            </div>
          </FloorPanel>
        </div>
      </div>
    </div>
  );
}
