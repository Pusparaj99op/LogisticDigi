'use client';

/**
 * The agent rail.
 *
 * A persistent column showing the swarm: the major agent at the top, its six
 * specialists beneath. This is not navigation — it is the org chart of who is
 * acting on the operator's behalf, and it stays visible because "which of my
 * agents is doing what" is the question this product exists to answer.
 *
 * Each specialist lists its own authority, taken from the capability table.
 * A reviewer can see least privilege in the interface, not only in the code.
 */

import type { AgentRole } from '@logisticdigi/core';
import { useRuns, useRunSteps } from '@/components/live';

export type AgentActivity = 'idle' | 'working' | 'waiting' | 'blocked';

export interface AgentState {
  readonly role: AgentRole;
  readonly activity: AgentActivity;
  readonly detail: string;
}

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
 * Live agent state, derived from the newest run that is still going. Shared
 * by the rail and the mesh graph so both agree on what "working" means.
 */
export function useAgentStates(tenantId: string | null): readonly AgentState[] {
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

export const AGENTS: readonly { role: AgentRole; name: string; authority: string }[] = [
  { role: 'inventory', name: 'Inventory', authority: 'Own stock only' },
  { role: 'procurement', name: 'Procurement', authority: 'Read the catalogue' },
  { role: 'negotiation', name: 'Negotiation', authority: 'Talk to counterparties' },
  { role: 'compliance', name: 'Compliance', authority: 'Verify and veto' },
  { role: 'settlement', name: 'Settlement', authority: 'Move funds, capped' },
  { role: 'logistics', name: 'Logistics', authority: 'Book and track cargo' },
];

const DOT: Record<AgentActivity, string> = {
  idle: 'bg-[var(--color-chalk-faint)]',
  working: 'bg-[var(--color-hazard)]',
  waiting: 'bg-[var(--color-chalk-soft)]',
  blocked: 'bg-[var(--color-refused)]',
};

export function AgentRail({ states }: { states: readonly AgentState[] }) {
  const byRole = new Map(states.map((state) => [state.role, state]));

  return (
    <nav
      aria-label="Agent swarm"
      className="flex w-60 shrink-0 flex-col border-r border-[var(--color-seam)] bg-[var(--color-steel)]"
    >
      <div className="border-b border-[var(--color-seam)] px-4 py-4">
        <p className="eyebrow">Major agent</p>
        <p className="mt-1 text-sm text-[var(--color-chalk)]">Holds the goal and the budget</p>
        <p className="mt-2 text-xs text-[var(--color-chalk-faint)]">
          Owns no tools. It can only delegate.
        </p>
      </div>

      <ul className="flex-1">
        {AGENTS.map((agent) => {
          const state = byRole.get(agent.role);
          const activity = state?.activity ?? 'idle';
          return (
            <li
              key={agent.role}
              className={`border-b border-[var(--color-seam)] px-4 py-3 ${
                activity === 'blocked' ? 'hazard-edge' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${DOT[activity]}`}
                />
                <span className="text-sm text-[var(--color-chalk)]">{agent.name}</span>
              </div>
              <p className="mt-1 pl-3.5 text-xs text-[var(--color-chalk-faint)]">
                {state?.detail ?? agent.authority}
              </p>
              <span className="sr-only">{activity}</span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
