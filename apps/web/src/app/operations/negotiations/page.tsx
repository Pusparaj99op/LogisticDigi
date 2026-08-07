'use client';

import { useEffect, useState } from 'react';
import { Empty, Eyebrow, FloorPanel, Marker, type Tone } from '@/components/primitives';
import { useNegotiationMessages, useNegotiations } from '@/components/live';
import { useSession } from '@/lib/auth-context';

/**
 * The negotiation transcripts.
 *
 * Every counterparty in this system is a simulated provider rather than
 * another signed-in tenant (see useNegotiations's comment in live.ts), so
 * this reads one-sided by construction — it is still the real exchange the
 * negotiation agent had, not a chat log invented for the screen. The
 * messages are written by services/orchestrator's negotiationDocsFrom,
 * grounded in the actual offer and the actual agreed price.
 */

const KIND_TONE: Record<string, Tone> = {
  proposal: 'neutral',
  counter: 'hazard',
  accept: 'clear',
  reject: 'refused',
  note: 'neutral',
};

export default function NegotiationsPage() {
  const session = useSession();
  const negotiations = useNegotiations(session.tenantId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && negotiations.items.length > 0) {
      setSelectedId(negotiations.items[0]?.id ?? null);
    }
  }, [negotiations.items, selectedId]);

  const messages = useNegotiationMessages(selectedId);
  const selected = negotiations.items.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Negotiations</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">What your agents agreed to</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-chalk-soft)]">
          The offer a counterparty made, the counter the negotiation agent settled at, and the
          acceptance — the real exchange, not a summary of it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <FloorPanel title="Threads">
          {!negotiations.ready ? (
            <Empty>Connecting to your workspace.</Empty>
          ) : negotiations.error ? (
            <Empty>Could not load negotiations: {negotiations.error}</Empty>
          ) : negotiations.items.length === 0 ? (
            <Empty>
              No negotiations yet. Once an agent quotes and counters a supplier, the exchange
              appears here.
            </Empty>
          ) : (
            <ul>
              {negotiations.items.map((negotiation) => {
                const active = negotiation.id === selectedId;
                return (
                  <li key={negotiation.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(negotiation.id)}
                      className={`block w-full border-b border-[var(--color-seam)] px-4 py-3 text-left transition-colors last:border-b-0 ${
                        active ? 'bg-[var(--color-steel-raised)]' : 'hover:bg-[var(--color-steel-raised)]'
                      }`}
                    >
                      <p className="truncate text-sm text-[var(--color-chalk)]">{negotiation.sellerName}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-chalk-faint)]">
                        {negotiation.title}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </FloorPanel>

        <FloorPanel title={selected ? selected.sellerName : 'Transcript'}>
          {!selected ? (
            <Empty>Select a negotiation to read the exchange.</Empty>
          ) : !messages.ready ? (
            <Empty>Loading the transcript.</Empty>
          ) : messages.error ? (
            <Empty>Could not load the transcript: {messages.error}</Empty>
          ) : messages.items.length === 0 ? (
            <Empty>No messages recorded for this negotiation.</Empty>
          ) : (
            <ul className="space-y-3 p-4">
              {messages.items.map((message) => (
                <li
                  key={message.id}
                  className="border-l-2 border-[var(--color-seam)] py-1 pl-4"
                >
                  <div className="flex items-center gap-2">
                    <Marker tone={KIND_TONE[message.kind ?? 'note'] ?? 'neutral'}>
                      {message.kind ?? 'note'}
                    </Marker>
                    <span className="eyebrow">{message.from}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-[var(--color-chalk-soft)]">{message.text}</p>
                </li>
              ))}
            </ul>
          )}
        </FloorPanel>
      </div>
    </div>
  );
}
