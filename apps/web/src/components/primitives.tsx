/**
 * Shared UI primitives.
 *
 * Deliberately few. The design rests on two surfaces (floor and paper) and one
 * signature marking (hazard), so most screens compose from these rather than
 * inventing new treatments.
 */

import type { ReactNode } from 'react';

/**
 * The hazard rule.
 *
 * Appears once per screen, at the boundary where autonomy stops and a human
 * decision begins. Never decorative — if it is on screen, something needs a
 * person. `label` names what is being asked.
 */
export function HazardBar({
  label,
  surface = 'floor',
}: {
  label: string;
  surface?: 'floor' | 'paper';
}) {
  return (
    <div role="separator" aria-label={label}>
      <div className={surface === 'paper' ? 'hazard-bar hazard-bar--paper' : 'hazard-bar'} />
      <p
        className={`eyebrow ${surface === 'paper' ? 'eyebrow--paper' : ''} mt-2`}
      >
        {label}
      </p>
    </div>
  );
}

/** A region label. Names a part of the screen; carries no other meaning. */
export function Eyebrow({
  children,
  surface = 'floor',
}: {
  children: ReactNode;
  surface?: 'floor' | 'paper';
}) {
  return (
    <p className={`eyebrow ${surface === 'paper' ? 'eyebrow--paper' : ''}`}>{children}</p>
  );
}

/** A panel on the machine floor: live, mechanical, in motion. */
export function FloorPanel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)] ${className}`}
    >
      {title ? (
        <header className="flex items-center justify-between border-b border-[var(--color-seam)] px-4 py-3">
          <h2 className="text-sm text-[var(--color-chalk)]">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A document. Money and evidence render here.
 *
 * Receipts, ledger entries, and approval requests are freight paperwork, and
 * paperwork should not look like a rounded card floating on a dashboard.
 */
export function Document({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <article className={`paper p-5 ${className}`}>{children}</article>;
}

/** A monospace figure: amount, txid, address, round. Aligns in columns. */
export function Figure({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`tabular ${className}`}>{children}</span>;
}

export type Tone = 'neutral' | 'hazard' | 'refused' | 'clear';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-[var(--color-seam)] text-[var(--color-chalk-soft)]',
  hazard: 'border-[var(--color-hazard)] text-[var(--color-hazard)]',
  refused: 'border-[var(--color-refused)] text-[var(--color-refused)]',
  clear: 'border-[var(--color-clear)] text-[var(--color-clear)]',
};

/** A status marking. Outline only — filled badges would compete with hazard. */
export function Marker({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`tabular inline-flex items-center border px-2 py-0.5 text-[0.6875rem] uppercase tracking-[0.1em] ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'quiet' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center rounded-[2px] px-4 py-2 text-sm font-medium ' +
    'transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const variants = {
    primary:
      'bg-[var(--color-hazard)] text-[var(--color-void)] hover:bg-[var(--color-hazard-deep)]',
    quiet:
      'border border-[var(--color-seam)] text-[var(--color-chalk)] hover:border-[var(--color-chalk-faint)]',
    danger:
      'border border-[var(--color-refused)] text-[var(--color-refused)] hover:bg-[color-mix(in_srgb,var(--color-refused)_12%,transparent)]',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

/**
 * An empty state.
 *
 * An empty screen is an invitation to act, so it says what will fill it and
 * how — never just "no data".
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-8 text-sm text-[var(--color-chalk-faint)]">{children}</p>
  );
}
