'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AgentRail, type AgentState } from '@/components/agent-rail';
import { Eyebrow } from '@/components/primitives';
import { useSession } from '@/lib/auth-context';

/**
 * Seed activity for the rail until a live run is attached.
 *
 * Stated plainly rather than faked as live data: an interface that invents
 * activity is lying to the operator about what its agents are doing.
 */
const IDLE_STATES: readonly AgentState[] = [];

const SECTIONS = [
  { href: '/operations', label: 'Floor' },
  { href: '/operations/approvals', label: 'Approvals' },
  { href: '/operations/negotiations', label: 'Negotiations' },
  { href: '/operations/ledger', label: 'Ledger' },
  { href: '/operations/map', label: 'Map' },
];

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

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
      <AgentRail states={IDLE_STATES} />

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
