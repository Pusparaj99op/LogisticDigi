'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AgentRail, type AgentActivity, type AgentState } from '@/components/agent-rail';
import { Eyebrow } from '@/components/primitives';
import { useRuns, useRunSteps } from '@/components/live';
import { useSession } from '@/lib/auth-context';
import type { AgentRole } from '@logisticdigi/core';

const SECTIONS = [
  { href: '/operations', label: 'Floor' },
  { href: '/operations/runs', label: 'Runs' },
  { href: '/operations/approvals', label: 'Approvals' },
  { href: '/operations/negotiations', label: 'Negotiations' },
  { href: '/operations/ledger', label: 'Ledger' },
  { href: '/operations/map', label: 'Map' },
];

/**
 * What a step's status means for the agent executing it.
 *
 * Only these four map to something worth showing. A `pending` or `succeeded`
 * step says nothing about what its agent is doing *now*, so it leaves the
 * agent idle rather than inventing activity — the rail must not claim an
 * agent is busy when it is not.
 */
const ACTIVITY_BY_STEP_STATUS: Record<string, AgentActivity> = {
  running: 'working',
  awaiting_approval: 'waiting',
  failed: 'blocked',
  cancelled: 'blocked',
};

/**
 * Live rail state, derived from the newest run that is still going.
 *
 * One run rather than every active run at once: the rail has a single row per
 * agent, so aggregating several concurrent runs into it would have to pick a
 * winner anyway, and "the run you are most likely looking at" is the honest
 * choice. When nothing is running every agent shows idle, which is true.
 */
function useAgentStates(tenantId: string | null): readonly AgentState[] {
  const runs = useRuns(tenantId, 20);
  const active = runs.items.find((run) => run.status === 'running') ?? null;
  const steps = useRunSteps(active?.id ?? null);

  const states: AgentState[] = [];
  for (const step of steps.items) {
    const activity = ACTIVITY_BY_STEP_STATUS[step.status];
    if (!activity) continue;
    states.push({
      role: step.role as AgentRole,
      activity,
      detail:
        activity === 'blocked'
          ? (step.error ?? step.skipReason ?? `${step.kind} could not complete`)
          : activity === 'waiting'
            ? 'waiting on your decision'
            : `${step.kind} — ${step.stepId}`,
    });
  }
  return states;
}

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const agentStates = useAgentStates(session.tenantId);

  useEffect(() => {
    if (!session.loading && !session.user) router.replace('/sign-in');
  }, [session.loading, session.user, router]);

  if (session.loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Eyebrow>Loading</Eyebrow>
      </div>
    );
  }

  if (!session.user) return null;

  return (
    <div className="flex min-h-dvh">
      <AgentRail states={agentStates} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-seam)] px-6 py-3">
          <nav className="flex items-center gap-1" aria-label="Sections">
            {SECTIONS.map((section) => {
              const active = pathname === section.href;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-[2px] px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-[var(--color-steel-raised)] text-[var(--color-chalk)]'
                      : 'text-[var(--color-chalk-faint)] hover:text-[var(--color-chalk)]'
                  }`}
                >
                  {section.label}
                </Link>
              );
            })}
            {session.platformOwner ? (
              <Link
                href="/operations/admin"
                aria-current={pathname === '/operations/admin' ? 'page' : undefined}
                className={`ml-2 rounded-[2px] border border-[var(--color-hazard)] px-3 py-1.5 text-sm text-[var(--color-hazard)] transition-colors hover:bg-[var(--color-hazard-wash)] ${
                  pathname === '/operations/admin' ? 'bg-[var(--color-hazard-wash)]' : ''
                }`}
              >
                Controls
              </Link>
            ) : null}
          </nav>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-[var(--color-chalk)]">
                {session.user.displayName ?? session.user.email}
              </p>
              <p className="eyebrow">{session.tenantId ?? 'no workspace yet'}</p>
            </div>
            <button
              type="button"
              onClick={() => void session.leave()}
              className="text-sm text-[var(--color-chalk-faint)] underline underline-offset-4 hover:text-[var(--color-chalk)]"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
