'use client';

/**
 * Agent mesh — every agent connected to every other agent, sticky-note
 * style, matching the reference board (image/networkdemo.jpg): irregular
 * boxes with a dense web of connecting lines through the center. Where
 * negotiation-thread.tsx renders one conversation as scrolling text, this
 * renders the *shape* of the swarm — who can reach whom — with the currently
 * busy agents lit up and their edges animated, so "agents talking to each
 * other" is a picture, not a transcript.
 */

import { useAgentStates, type AgentActivity } from '@/components/agent-rail';
import { useSession } from '@/lib/auth-context';

const W = 640;
const H = 380;

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
// reads as a pinned-up board rather than a generated diagram.
const NODES: readonly Node[] = [
  { id: 'major', label: 'MAJOR AGENT', sub: 'holds the goal', x: 0.5, y: 0.14, rotate: -2, kind: 'major' },
  { id: 'inventory', label: 'INVENTORY', sub: 'own stock only', x: 0.12, y: 0.32, rotate: -4, kind: 'specialist' },
  { id: 'procurement', label: 'PROCUREMENT', sub: 'read the catalogue', x: 0.82, y: 0.28, rotate: 3, kind: 'specialist' },
  { id: 'negotiation', label: 'NEGOTIATION', sub: 'talks to counterparties', x: 0.06, y: 0.68, rotate: 5, kind: 'specialist' },
  { id: 'compliance', label: 'COMPLIANCE', sub: 'verify and veto', x: 0.9, y: 0.7, rotate: -3, kind: 'specialist' },
  { id: 'settlement', label: 'SETTLEMENT', sub: 'moves funds, capped', x: 0.35, y: 0.86, rotate: 2, kind: 'specialist' },
  { id: 'logistics', label: 'LOGISTICS', sub: 'book and track cargo', x: 0.65, y: 0.88, rotate: -5, kind: 'specialist' },
];

function px(fraction: number, span: number): number {
  return fraction * span;
}

export function AgentMesh() {
  const session = useSession();
  const states = useAgentStates(session.tenantId);
  const activityOf = (id: string): AgentActivity => {
    if (id === 'major') return states.some((s) => s.activity === 'working') ? 'working' : 'idle';
    return states.find((s) => s.role === id)?.activity ?? 'idle';
  };

  const pairs: [Node, Node][] = [];
  for (let i = 0; i < NODES.length; i++) {
    for (let j = i + 1; j < NODES.length; j++) {
      const a = NODES[i];
      const b = NODES[j];
      if (a && b) pairs.push([a, b]);
    }
  }

  return (
    <div className="relative w-full overflow-hidden rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)]">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Agent network">
        <g stroke="var(--color-seam)" strokeWidth={1}>
          {pairs.map(([a, b], i) => {
            const busy = activityOf(a.id) === 'working' || activityOf(b.id) === 'working';
            return (
              <line
                key={`${a.id}-${b.id}`}
                x1={px(a.x, W)}
                y1={px(a.y, H)}
                x2={px(b.x, W)}
                y2={px(b.y, H)}
                stroke={busy ? 'var(--color-hazard)' : 'var(--color-seam)'}
                strokeOpacity={busy ? 0.85 : 0.35}
                strokeWidth={busy ? 1.5 : 1}
                className={busy ? 'mesh-edge-live' : undefined}
                style={{ animationDelay: `${(i % 7) * 0.15}s` }}
              />
            );
          })}
        </g>

        {NODES.map((node) => {
          const activity = activityOf(node.id);
          const fill = node.kind === 'major' ? 'var(--color-hazard-wash, #f5d97a)' : 'var(--color-refused-wash, #d9635a)';
          const cx = px(node.x, W);
          const cy = px(node.y, H);
          const boxW = node.kind === 'major' ? 118 : 108;
          const boxH = 46;
          return (
            <g key={node.id} transform={`translate(${cx - boxW / 2}, ${cy - boxH / 2}) rotate(${node.rotate}, ${boxW / 2}, ${boxH / 2})`}>
              <rect
                width={boxW}
                height={boxH}
                fill={fill}
                stroke={activity === 'working' ? 'var(--color-hazard)' : 'rgba(0,0,0,0.25)'}
                strokeWidth={activity === 'working' ? 2 : 1}
                rx={1}
              />
              <text x={boxW / 2} y={18} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#1a1512">
                {node.label}
              </text>
              <text x={boxW / 2} y={31} textAnchor="middle" fontSize={7.5} fill="#3a2f28">
                {node.sub}
              </text>
              {activity === 'working' ? (
                <circle cx={boxW - 8} cy={8} r={4} fill="var(--color-hazard)" className="mesh-node-pulse" />
              ) : null}
            </g>
          );
        })}
      </svg>

      <style>{`
        .mesh-edge-live {
          stroke-dasharray: 4 3;
          animation: mesh-dash 1.2s linear infinite;
        }
        @keyframes mesh-dash {
          to { stroke-dashoffset: -14; }
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
