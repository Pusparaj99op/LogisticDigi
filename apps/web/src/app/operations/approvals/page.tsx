'use client';

import { doc, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import { formatMoney } from '@logisticdigi/core';
import { Button, Document, Empty, Eyebrow, Figure, HazardBar } from '@/components/primitives';
import { usePendingApprovals } from '@/components/live';
import { firestore } from '@/lib/firebase';
import { useSession } from '@/lib/auth-context';

/**
 * The approval inbox.
 *
 * The one screen where a human acts on the system rather than watching it, and
 * the only collection a client may write to at all. Requests render as
 * documents because that is what they are: a payment authorisation with an
 * amount, a counterparty, and a reason.
 */
export default function ApprovalsPage() {
  const session = useSession();
  const approvals = usePendingApprovals(session.tenantId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approvalId: string, approved: boolean) {
    if (!session.user) return;
    setBusy(approvalId);
    setError(null);
    try {
      // The rules accept only these four fields, only while pending, and only
      // attributed to the signed-in user.
      await updateDoc(doc(firestore(), 'approvals', approvalId), {
        status: approved ? 'approved' : 'rejected',
        decidedBy: session.user.uid,
        decidedAt: Date.now(),
        note: approved ? 'Approved from the operations console' : 'Rejected by the operator',
      });
    } catch (cause) {
      setError(
        `That decision did not save: ${(cause as Error).message}. The request may have already ` +
          'been decided elsewhere.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Approvals</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">Decisions waiting on you</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-chalk-soft)]">
          Agents pause here when a payment is above your threshold. Nothing settles until you
          decide.
        </p>
      </div>

      {error ? (
        <p className="border-l-2 border-[var(--color-refused)] pl-3 text-sm text-[var(--color-refused)]">
          {error}
        </p>
      ) : null}

      {!approvals.ready ? (
        <Empty>Connecting to your workspace.</Empty>
      ) : approvals.error ? (
        <Empty>Could not load approvals: {approvals.error}</Empty>
      ) : approvals.items.length === 0 ? (
        <Empty>
          Nothing is waiting. When an agent proposes a payment above your threshold, it stops here
          and asks.
        </Empty>
      ) : (
        <>
          <HazardBar
            label={`${approvals.items.length} payment${
              approvals.items.length === 1 ? '' : 's'
            } cannot proceed without a person`}
          />

          <ul className="grid gap-4 lg:grid-cols-2">
            {approvals.items.map((approval) => (
              <li key={approval.id}>
                <Document>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <Eyebrow surface="paper">Pay {approval.counterparty}</Eyebrow>
                      <p className="mt-2 text-[var(--color-ink)]">{approval.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Figure className="text-2xl text-[var(--color-ink)]">
                        {formatMoney({
                          asset: (approval.asset as 'USDC' | 'ALGO') ?? 'USDC',
                          units: BigInt(approval.amountUnits),
                        })}
                      </Figure>
                    </div>
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--color-paper-shade)] pt-4 text-xs">
                    <div>
                      <dt className="eyebrow eyebrow--paper">Why it stopped</dt>
                      <dd className="mt-1 text-[var(--color-ink-soft)]">{approval.reason}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow eyebrow--paper">Run and step</dt>
                      <dd className="tabular mt-1 text-[var(--color-ink-soft)]">
                        {approval.runId} / {approval.stepId}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex gap-3">
                    <Button
                      onClick={() => void decide(approval.id, true)}
                      disabled={busy === approval.id}
                    >
                      Approve payment
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void decide(approval.id, false)}
                      disabled={busy === approval.id}
                    >
                      Reject
                    </Button>
                  </div>
                </Document>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
