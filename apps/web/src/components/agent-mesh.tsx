'use client';

/**
 * Agent mesh — every agent connected to every other agent, sticky-note
 * style, matching the reference board (image/networkdemo.jpg): irregular
 * boxes with a dense web of connecting lines through the center. Where
 * negotiation-thread.tsx renders one conversation as scrolling text, this
 * renders the *shape* of the swarm — who can reach whom — with the one pair
 * actually talking right now lit up and animated toward the listener,
 * everything else dim, and every node inspectable on hover/click.
 */

import { useState } from 'react';
import { AGENTS, useAgentMeshState } from '@/components/agent-rail';
import { useSession } from '@/lib/auth-context';

const W = 640;
const H = 440;

interface Node {
  readonly id: string;
  readonly label: string;
  readonly sub: string;
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly kind: 'major' | 'specialist';
}

// Irregular, hand-placed layout — deliberately not a circle or grid, so it
// reads as a pinned-up board rather than a generated diagram. Margins kept
// away from the frame so no box crowds the edge.
const NODES: readonly Node[] = [
  { id: 'major', label: 'MAJOR AGENT', sub: 'holds the goal', x: 0.5, y: 0.15, rotate: -2, kind: 'major' },
  { id: 'inventory', label: 'INVENTORY', sub: 'own stock only', x: 0.16, y: 0.34, rotate: -4, kind: 'specialist' },
  { id: 'procurement', label: 'PROCUREMENT', sub: 'read the catalogue', x: 0.78, y: 0.3, rotate: 3, kind: 'specialist' },
  { id: 'negotiation', label: 'NEGOTIATION', sub: 'talks to counterparties', x: 0.11, y: 0.66, rotate: 5, kind: 'specialist' },
  { id: 'compliance', label: 'COMPLIANCE', sub: 'verify and veto', x: 0.85, y: 0.68, rotate: -3, kind: 'specialist' },
  { id: 'settlement', label: 'SETTLEMENT', sub: 'moves funds, capped', x: 0.36, y: 0.85, rotate: 2, kind: 'specialist' },
  { id: 'logistics', label: 'LOGISTICS', sub: 'book and track cargo', x: 0.64, y: 0.85, rotate: -5, kind: 'specialist' },
];

const AUTHORITY_BY_ID: Record<string, string> = {
  major: 'Holds the goal and the budget. Owns no tools — can only delegate.',
  ...Object.fromEntries(AGENTS.map((a) => [a.role, a.authority])),
};
const NAME_BY_ID: Record<string, string> = {
  major: 'Major agent',
  ...Object.fromEntries(AGENTS.map((a) => [a.role, a.name])),
};

function px(fraction: number, span: number): number {
  return fraction * span;
}

function nodeBoxSize(kind: Node['kind']): { w: number; h: number } {
  return kind === 'major' ? { w: 122, h: 48 } : { w: 112, h: 48 };
}

export function AgentMesh() {
  const session = useSession();
  const { states, callerListener } = useAgentMeshState(session.tenantId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const detailByRole = new Map<string, string>(states.map((s) => [s.role, s.detail]));
  const byId = new Map(NODES.map((n) => [n.id, n]));

  const pairs: [Node, Node][] = [];
  for (let i = 0; i < NODES.length; i++) {
    for (let j = i + 1; j < NODES.length; j++) {
      const a = NODES[i];
      const b = NODES[j];
      if (a && b) pairs.push([a, b]);
    }
  }

  const activeEdge = callerListener && byId.has(callerListener.caller) && byId.has(callerListener.listener)
    ? callerListener
    : null;

  const focusId = hoveredId ?? selectedId;
  const selected = selectedId ? byId.get(selectedId) : null;

  return (
    <div className="relative w-full overflow-hidden rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Agent network — who is reachable by whom, and who is talking right now"
      >
        <defs>
          <filter id="mesh-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000" floodOpacity="0.45" />
          </filter>
          <marker id="mesh-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#FFC400" />
          </marker>
        </defs>

        <g strokeWidth={1}>
          {pairs.map(([a, b]) => {
            const isFocusEdge = focusId != null && (a.id === focusId || b.id === focusId);
            const dimmed = focusId != null && !isFocusEdge;
            return (
              <line
                key={`${a.id}-${b.id}`}
                x1={px(a.x, W)}
                y1={px(a.y, H)}
                x2={px(b.x, W)}
                y2={px(b.y, H)}
                stroke={isFocusEdge ? 'var(--color-chalk-soft)' : 'var(--color-seam)'}
                strokeOpacity={dimmed ? 0.12 : isFocusEdge ? 0.7 : 0.35}
                strokeWidth={isFocusEdge ? 1.5 : 1}
                style={{ transition: 'stroke-opacity 150ms ease' }}
              />
            );
          })}
        </g>

        {activeEdge
          ? (() => {
              const a = byId.get(activeEdge.caller);
              const b = byId.get(activeEdge.listener);
              if (!a || !b) return null;
              const x1 = px(a.x, W);
              const y1 = px(a.y, H);
              const x2 = px(b.x, W);
              const y2 = px(b.y, H);
              const pathId = 'mesh-active-path';
              return (
                <g>
                  <path
                    id={pathId}
                    d={`M ${x1} ${y1} L ${x2} ${y2}`}
                    fill="none"
                    stroke="#FFC400"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    className="mesh-edge-live"
                    markerEnd="url(#mesh-arrow)"
                  />
                  <circle r={4.5} fill="#FFC400">
                    <animateMotion dur="1.6s" repeatCount="indefinite" path={`M ${x1} ${y1} L ${x2} ${y2}`} />
                  </circle>
                </g>
              );
            })()
          : null}

        {NODES.map((node) => {
          const activity = node.id === 'major'
            ? states.some((s) => s.activity === 'working') ? 'working' : 'idle'
            : (states.find((s) => s.role === node.id)?.activity ?? 'idle');
          const fill = node.kind === 'major' ? '#FFC400' : '#E8635A';
          const cx = px(node.x, W);
          const cy = px(node.y, H);
          const { w: boxW, h: boxH } = nodeBoxSize(node.kind);
          const isFocus = focusId === node.id;
          const dimmed = focusId != null && !isFocus;

          return (
            <g
              key={node.id}
              transform={`translate(${cx - boxW / 2}, ${cy - boxH / 2}) rotate(${node.rotate}, ${boxW / 2}, ${boxH / 2})`}
              filter="url(#mesh-shadow)"
              opacity={dimmed ? 0.45 : 1}
              style={{ transition: 'opacity 150ms ease, transform 150ms ease', cursor: 'pointer' }}
              tabIndex={0}
              role="button"
              aria-label={`${NAME_BY_ID[node.id]}: ${AUTHORITY_BY_ID[node.id]}`}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(node.id)}
              onBlur={() => setHoveredId(null)}
              onClick={() => setSelectedId((cur) => (cur === node.id ? null : node.id))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedId((cur) => (cur === node.id ? null : node.id));
                }
              }}
            >
              <rect
                width={boxW}
                height={boxH}
                fill={fill}
                stroke={activity === 'working' || isFocus ? '#FFC400' : 'rgba(0,0,0,0.3)'}
                strokeWidth={activity === 'working' || isFocus ? 2 : 1}
                rx={1}
              />
              <text x={boxW / 2} y={19} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#1a1512">
                {node.label}
              </text>
              <text x={boxW / 2} y={32} textAnchor="middle" fontSize={7.5} fill="#3a2f28">
                {node.sub}
              </text>
              {activity === 'working' ? (
                <circle cx={boxW - 8} cy={8} r={4} fill="#1a1512" className="mesh-node-pulse" />
              ) : null}
            </g>
          );
        })}
      </svg>

      {selected ? (
        <div
          className="absolute z-10 max-w-[220px] rounded-[2px] border border-[var(--color-hazard)] bg-[var(--color-steel-raised)] p-3 shadow-lg"
          style={{
            left: `${selected.x * 100}%`,
            top: `${Math.min(selected.y * 100 + 8, 82)}%`,
            transform: 'translateX(-50%)',
          }}
          role="dialog"
          aria-label={`${NAME_BY_ID[selected.id]} details`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-[var(--color-chalk)]">{NAME_BY_ID[selected.id]}</p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
              className="text-[var(--color-chalk-faint)] hover:text-[var(--color-chalk)]"
            >
              ×
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-chalk-soft)]">{AUTHORITY_BY_ID[selected.id]}</p>
          {detailByRole.get(selected.id) ? (
            <p className="mt-2 text-xs text-[var(--color-hazard)]">{detailByRole.get(selected.id)}</p>
          ) : null}
        </div>
      ) : null}

      <style>{`
        .mesh-edge-live {
          animation: mesh-dash 1s linear infinite;
        }
        @keyframes mesh-dash {
          to { stroke-dashoffset: -20; }
        }
        .mesh-node-pulse {
          animation: mesh-pulse 1s ease-in-out infinite;
        }
        @keyframes mesh-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
