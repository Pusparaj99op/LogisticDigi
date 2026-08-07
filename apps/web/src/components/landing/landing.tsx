'use client';

import Link from 'next/link';
import { useRef, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { GlobeField } from './globe-field';
import { Negotiation } from './negotiation';
import { SmoothScroll } from './smooth-scroll';
import { HeroIntro } from '@/components/HeroIntro';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/** The six specialists, each with the authority it actually holds. */
const SWARM: readonly { name: string; can: string; cannot: string }[] = [
  { name: 'Inventory', can: 'Reads and reserves your own stock', cannot: 'Cannot see another company’s' },
  { name: 'Procurement', can: 'Searches the shared catalogue', cannot: 'Cannot send or spend anything' },
  { name: 'Negotiation', can: 'Bargains with counterparties', cannot: 'Cannot move funds' },
  { name: 'Compliance', can: 'Verifies goods and blocks steps', cannot: 'Its veto cannot be overridden' },
  { name: 'Settlement', can: 'Pays, up to the cap on each step', cannot: 'Cannot pay twice' },
  { name: 'Logistics', can: 'Books and tracks cargo', cannot: 'Cannot approve its own spend' },
];

/** Numbers from the evaluation suite, including the one that reads against us. */
const EVIDENCE: readonly { metric: string; ours: string; without: string; note?: string }[] = [
  { metric: 'Scenarios handled correctly', ours: '9', without: '3' },
  { metric: 'Budget overspends', ours: '0', without: '1' },
  { metric: 'Injected instructions obeyed', ours: '0', without: '1' },
  { metric: 'Expired quotes acted on', ours: '0', without: '1' },
  { metric: 'Bad deliveries accepted', ours: '0', without: '2' },
  {
    metric: 'Workflows completed',
    ours: '4',
    without: '8',
    note: 'Fewer, because refusing a bad deal is the point.',
  },
];

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [introDone, setIntroDone] = useState(false);
  const handleIntroDone = useCallback(() => setIntroDone(true), []);

  useGSAP(
    () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return;

      // Sections rise as they enter. One reveal, applied consistently, rather
      // than a different effect per section.
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((element) => {
        gsap.from(element, {
          y: 28,
          opacity: 0,
          duration: 0.7,
          ease: 'power2.out',
          scrollTrigger: { trigger: element, start: 'top 85%' },
        });
      });

      // The hazard rule draws across as the approval section arrives. It is
      // the one scrubbed animation on the page, because it is the one moment
      // that deserves the reader's hand on the scrollbar.
      const rule = root.current?.querySelector('[data-hazard-draw]');
      if (rule) {
        gsap.fromTo(
          rule,
          { scaleX: 0, transformOrigin: 'left center' },
          {
            scaleX: 1,
            ease: 'none',
            scrollTrigger: { trigger: rule, start: 'top 90%', end: 'top 45%', scrub: 0.4 },
          },
        );
      }
    },
    { scope: root },
  );

  return (
    <>
      {/* ── loading intro — auto-plays then unmounts ── */}
      <HeroIntro onDone={handleIntroDone} />

      {/* ── main page — rendered beneath, becomes interactive after intro ── */}
      <div
        style={{
          opacity: introDone ? 1 : 0,
          transition: 'opacity 400ms ease',
          pointerEvents: introDone ? 'auto' : 'none',
        }}
      >
    <SmoothScroll>
      <div ref={root} className="overflow-x-hidden">
        {/* ---------------- hero ---------------- */}
        <header className="relative min-h-dvh">
          <GlobeField className="pointer-events-none absolute inset-0" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              // A horizontal scrim, not a radial one. The radial version was
              // centred close enough to the globe to smother it entirely; this
              // protects the headline and lets the sphere read on the right.
              // Only a soft left fade. Anything heavier smothers the sphere —
              // the globe is dark enough that the headline stays legible over
              // it without help.
              background:
                'linear-gradient(90deg, var(--color-void) 0%, ' +
                'color-mix(in srgb, var(--color-void) 55%, transparent) 22%, transparent 46%)',
            }}
          />

          <div className="relative mx-auto grid min-h-dvh max-w-7xl items-center gap-16 px-6 py-16 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="eyebrow">LogisticDigi</p>
              <h1 className="mt-6 text-[clamp(2.8rem,6.4vw,5.6rem)] text-[var(--color-chalk)]">
                Your agents
                <br />
                negotiate.
                <br />
                <span className="text-[var(--color-hazard)]">You decide.</span>
              </h1>
              <p className="mt-7 max-w-lg text-lg text-[var(--color-chalk-soft)]">
                Specialist agents find surplus stock across companies, bargain over it, and settle
                on Algorand. They stop and ask before they spend past your limit — and everything
                they were stopped from doing is on the record too.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/sign-in"
                  className="rounded-[2px] bg-[var(--color-hazard)] px-5 py-3 text-sm font-medium text-[var(--color-void)] transition-colors hover:bg-[var(--color-hazard-deep)]"
                >
                  Open the console
                </Link>
                <a
                  href="#evidence"
                  className="rounded-[2px] border border-[var(--color-seam)] px-5 py-3 text-sm text-[var(--color-chalk)] transition-colors hover:border-[var(--color-chalk-faint)]"
                >
                  See the numbers
                </a>
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <Negotiation />
            </div>
          </div>
        </header>

        {/* ---------------- the swarm ---------------- */}
        <section className="border-t border-[var(--color-seam)] px-6 py-28">
          <div className="mx-auto max-w-7xl">
            <div data-reveal className="max-w-2xl">
              <p className="eyebrow">One agent per company, six specialists beneath it</p>
              <h2 className="mt-4 text-[clamp(2rem,3.6vw,3.2rem)] text-[var(--color-chalk)]">
                Nobody holds
                <br />
                every key
              </h2>
              <p className="mt-5 text-[var(--color-chalk-soft)]">
                The agent that plans owns no tools at all — it can only delegate. Each specialist
                gets exactly the authority its job needs, so a confused or manipulated planner
                cannot reach a wallet.
              </p>
            </div>

            <ul data-reveal className="mt-14 grid gap-px bg-[var(--color-seam)] sm:grid-cols-2 lg:grid-cols-3">
              {SWARM.map((agent) => (
                <li key={agent.name} className="bg-[var(--color-void)] p-6">
                  <h3 className="text-lg text-[var(--color-chalk)]">{agent.name}</h3>
                  <p className="mt-3 text-sm text-[var(--color-chalk-soft)]">{agent.can}</p>
                  <p className="mt-2 text-sm text-[var(--color-chalk-faint)]">{agent.cannot}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- the approval moment ---------------- */}
        <section className="border-t border-[var(--color-seam)] px-6 py-28">
          <div className="mx-auto max-w-7xl">
            <div data-hazard-draw className="hazard-bar" />
            <div className="mt-10 grid gap-14 lg:grid-cols-2">
              <div data-reveal>
                <p className="eyebrow">Where autonomy stops</p>
                <h2 className="mt-4 text-[clamp(2rem,3.6vw,3.2rem)] text-[var(--color-chalk)]">
                  The machine
                  <br />
                  asks first
                </h2>
                <p className="mt-5 max-w-md text-[var(--color-chalk-soft)]">
                  Set a threshold. Above it, agents pause and put the payment in front of you with
                  the price, the counterparty, and why it stopped. Below it, they get on with it.
                </p>
                <p className="mt-4 max-w-md text-[var(--color-chalk-soft)]">
                  You will see this striped rule in the console too. It appears in exactly one
                  place: the line a person has to cross.
                </p>
              </div>

              <div data-reveal className="paper p-6">
                <p className="eyebrow eyebrow--paper">Waiting for a person</p>
                <div className="mt-4 flex items-start justify-between gap-6">
                  <p className="text-[var(--color-ink)]">
                    Pay Meridian Trading for one reefer container, Rotterdam to Mumbai, departing
                    Friday.
                  </p>
                  <p className="tabular shrink-0 text-2xl text-[var(--color-ink)]">232.00</p>
                </div>
                <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--color-paper-shade)] pt-4 text-xs">
                  <div>
                    <dt className="eyebrow eyebrow--paper">Why it stopped</dt>
                    <dd className="mt-1 text-[var(--color-ink-soft)]">
                      Above your 200.00 USDC threshold
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow eyebrow--paper">If you do nothing</dt>
                    <dd className="mt-1 text-[var(--color-ink-soft)]">
                      The quote expires and nothing is paid
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- settlement ---------------- */}
        <section className="border-t border-[var(--color-seam)] px-6 py-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1fr_1.1fr]">
            <div data-reveal>
              <p className="eyebrow">Settlement</p>
              <h2 className="mt-4 text-[clamp(2rem,3.6vw,3.2rem)] text-[var(--color-chalk)]">
                Paid once,
                <br />
                provably
              </h2>
              <p className="mt-5 max-w-md text-[var(--color-chalk-soft)]">
                Payments settle in USDC on Algorand over HTTP 402. Every authorisation carries a
                single-use value that is written into the transaction itself, so the network — not
                just our database — rejects a repeat.
              </p>
              <p className="mt-4 max-w-md text-[var(--color-chalk-soft)]">
                Each receipt links to the transaction on a public explorer. You never have to take
                our word for what was paid.
              </p>
            </div>

            <div data-reveal className="rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)] p-6">
              <p className="eyebrow">Receipt</p>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ['Paid', '232.000000 USDC'],
                  ['To', 'Meridian Trading'],
                  ['Scheme', 'exact · algorand-testnet'],
                  ['Confirmed', 'round 66,084,987'],
                ].map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-6 border-b border-[var(--color-seam)] pb-3 last:border-b-0">
                    <dt className="text-[var(--color-chalk-faint)]">{term}</dt>
                    <dd className="tabular text-right text-[var(--color-chalk)]">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-xs text-[var(--color-chalk-faint)]">
                Demonstrations run on Algorand TestNet. No real funds move.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- evidence ---------------- */}
        <section id="evidence" className="border-t border-[var(--color-seam)] px-6 py-28">
          <div className="mx-auto max-w-5xl">
            <div data-reveal>
              <p className="eyebrow">Evaluation · nine seeded scenarios</p>
              <h2 className="mt-4 text-[clamp(2rem,3.6vw,3.2rem)] text-[var(--color-chalk)]">
                Measured against
                <br />
                doing it without us
              </h2>
              <p className="mt-5 max-w-2xl text-[var(--color-chalk-soft)]">
                Both columns run the same workflows against the same suppliers — some of whom lie
                about quality, raise their price after you agree, or hide instructions in their
                terms. The right column is a competent implementation with no policy layer.
              </p>
            </div>

            <table data-reveal className="mt-12 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-seam)]">
                  <th className="eyebrow py-3 text-left font-normal">Measure</th>
                  <th className="eyebrow py-3 text-right font-normal">LogisticDigi</th>
                  <th className="eyebrow py-3 text-right font-normal">Without the guards</th>
                </tr>
              </thead>
              <tbody>
                {EVIDENCE.map((row) => (
                  <tr key={row.metric} className="border-b border-[var(--color-seam)]">
                    <td className="py-4 text-[var(--color-chalk-soft)]">
                      {row.metric}
                      {row.note ? (
                        <span className="mt-1 block text-xs text-[var(--color-chalk-faint)]">
                          {row.note}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular py-4 text-right text-xl text-[var(--color-hazard)]">
                      {row.ours}
                    </td>
                    <td className="tabular py-4 text-right text-xl text-[var(--color-chalk-faint)]">
                      {row.without}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p data-reveal className="mt-6 text-xs text-[var(--color-chalk-faint)]">
              The suite is seeded, so these numbers reproduce on any machine. It runs on every
              commit and the full report — failures included — is published with the build.
            </p>
          </div>
        </section>

        {/* ---------------- close ---------------- */}
        <footer className="border-t border-[var(--color-seam)] px-6 py-24">
          <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-10">
            <div data-reveal>
              <h2 className="text-[clamp(1.8rem,3vw,2.6rem)] text-[var(--color-chalk)]">
                Put your agents
                <br />
                on the floor
              </h2>
              <Link
                href="/sign-in"
                className="mt-7 inline-block rounded-[2px] bg-[var(--color-hazard)] px-5 py-3 text-sm font-medium text-[var(--color-void)] transition-colors hover:bg-[var(--color-hazard-deep)]"
              >
                Open the console
              </Link>
            </div>
            <p className="eyebrow max-w-xs">
              Built for the agentic commerce track. TestNet only — no real funds move.
            </p>
          </div>
        </footer>
      </div>
    </SmoothScroll>
      </div>
    </>
  );
}
