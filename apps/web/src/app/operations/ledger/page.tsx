'use client';

import { formatMoney } from '@logisticdigi/core';
import { Empty, Eyebrow, Figure, Marker, type Tone } from '@/components/primitives';
import { useLedger } from '@/components/live';
import { useSession } from '@/lib/auth-context';

/**
 * The ledger.
 *
 * Every movement of money, in order, with the transaction that caused it. This
 * is evidence: the security rules make it read-only to every client, so a
 * tenant can see its own history but cannot rewrite it.
 */

const KIND_TONE: Record<string, Tone> = {
  reserved: 'neutral',
  settled: 'clear',
  released: 'neutral',
  refunded: 'hazard',
};

const KIND_MEANING: Record<string, string> = {
  reserved: 'earmarked, not yet paid',
  settled: 'paid on chain',
  released: 'earmark returned unused',
  refunded: 'recovered from the counterparty',
};

export default function LedgerPage() {
  const session = useSession();
  const ledger = useLedger(session.tenantId);

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Ledger</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">Every movement of money</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-chalk-soft)]">
          Written by the orchestrator and read-only to everyone, including us. Settled entries link
          to the transaction on Algorand so you can check them yourself.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[2px] border border-[var(--color-seam)]">
        {!ledger.ready ? (
          <Empty>Connecting to your workspace.</Empty>
        ) : ledger.error ? (
          <Empty>Could not load the ledger: {ledger.error}</Empty>
        ) : ledger.items.length === 0 ? (
          <Empty>
            No entries yet. Reservations, settlements, and refunds appear here the moment an agent
            moves money.
          </Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-seam)]">
                {['When', 'Movement', 'Counterparty', 'Amount', 'Transaction'].map((heading) => (
                  <th key={heading} className="eyebrow px-4 py-3 text-left font-normal">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledger.items.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--color-seam)] last:border-b-0">
                  <td className="tabular px-4 py-3 text-[var(--color-chalk-faint)]">
                    {new Date(entry.recordedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Marker tone={KIND_TONE[entry.kind] ?? 'neutral'}>{entry.kind}</Marker>
                    <span className="ml-2 text-xs text-[var(--color-chalk-faint)]">
                      {KIND_MEANING[entry.kind] ?? ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-chalk-soft)]">{entry.counterparty}</td>
                  <td className="px-4 py-3 text-right">
                    <Figure className="text-[var(--color-chalk)]">
                      {formatMoney({
                        asset: (entry.asset as 'USDC' | 'ALGO') ?? 'USDC',
                        units: BigInt(entry.amountUnits),
                      })}
                    </Figure>
                  </td>
                  <td className="px-4 py-3">
                    {entry.explorerUrl ? (
                      <a
                        href={entry.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="tabular text-xs text-[var(--color-hazard)] underline underline-offset-4"
                      >
                        {entry.txid?.slice(0, 12)}…
                      </a>
                    ) : (
                      <span className="text-xs text-[var(--color-chalk-faint)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
