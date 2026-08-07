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

export type AgentActivity = 'idle' | 'working' | 'waiting' | 'blocked';

export interface AgentState {
  readonly role: AgentRole;
  readonly activity: AgentActivity;
  readonly detail: string;
}

const AGENTS: readonly { role: AgentRole; name: string; authority: string }[] = [
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
