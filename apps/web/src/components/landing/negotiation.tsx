'use client';

/**
 * The hero: two agents converging on a price.
 *
 * This is the thesis of the whole product, so it is the first thing on the
 * page. Not a stat tile, not a product screenshot — the actual thing that
 * happens: one company's procurement agent and another's negotiation agent
 * bargaining over a reefer container, and then stopping to ask a person.
 *
 * The transcript is scripted rather than live. It is a marketing page, and a
 * fake "live" feed would be a lie about a product whose entire claim is that
 * its record can be trusted. The copy says so plainly beneath it.
 */

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { THINKING_LOTTIE } from './thinking';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

interface Line {
  readonly side: 'buyer' | 'seller';
  readonly who: string;
  readonly text: string;
  /** Rendered as a figure rather than prose: it is the number under debate. */
  readonly price?: string;
}

const SCRIPT: readonly Line[] = [
  {
    side: 'buyer',
    who: 'Northwind · procurement',
    text: 'Reefer 40ft, Rotterdam to Mumbai, chilled. What can you do?',
  },
  {
    side: 'seller',
    who: 'Meridian · negotiation',
    text: 'We have capacity Friday. All-in, including insurance.',
    price: '248.00 USDC',
  },
  {
    side: 'buyer',
    who: 'Northwind · procurement',
    text: 'Two other carriers quoted under 220. Match it and we book now.',
    price: '219.50 USDC',
  },
  {
    side: 'seller',
    who: 'Meridian · negotiation',
    text: 'We can meet you at 232 if you take Friday rather than Monday.',
    price: '232.00 USDC',
  },
  {
    side: 'buyer',
    who: 'Northwind · procurement',
    text: 'Agreed at 232. Sending for approval — this is above your threshold.',
    price: '232.00 USDC',
  },
];

export function Negotiation() {
  const [shown, setShown] = useState(0);
  const [thinking, setThinking] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      // Show the whole exchange at once rather than animating it.
      setShown(SCRIPT.length);
      return;
    }

    let delay = 600;
    for (let index = 0; index < SCRIPT.length; index += 1) {
      timers.current.push(
        setTimeout(() => {
          setThinking(true);
        }, delay),
      );
      delay += 700;
      timers.current.push(
        setTimeout(() => {
          setThinking(false);
          setShown(index + 1);
        }, delay),
      );
      delay += 1500;
    }

    const local = timers.current;
    return () => {
      for (const timer of local) clearTimeout(timer);
    };
  }, []);

  const settled = shown >= SCRIPT.length;

  // A soft scrim sits behind the transcript: it overlays the globe's limb and
  // the arcs, and the text has to stay readable without hiding the backdrop.
  return (
    <div className="w-full max-w-lg rounded-[2px] bg-[color-mix(in_srgb,var(--color-void)_58%,transparent)] p-5 backdrop-blur-[2px]">
      <div className="flex items-center justify-between border-b border-[var(--color-seam)] pb-3">
        <p className="eyebrow">Negotiation · live on the floor</p>
        {thinking ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4">
              <Lottie animationData={THINKING_LOTTIE} loop autoplay />
            </span>
            <span className="eyebrow">composing</span>
          </span>
        ) : null}
      </div>

      <ol className="mt-4 space-y-3">
        {SCRIPT.slice(0, shown).map((line, index) => (
          <li
            key={line.who + String(index)}
            className={`arriving border-l-2 border-[var(--color-seam)] pl-4 ${
              line.side === 'seller' ? 'ml-8' : ''
            }`}
          >
            <p className="eyebrow">{line.who}</p>
            <p className="mt-1 text-sm text-[var(--color-chalk)]">{line.text}</p>
            {line.price ? (
              <p className="tabular mt-1 text-sm text-[var(--color-hazard)]">{line.price}</p>
            ) : null}
          </li>
        ))}
      </ol>

      {/*
        The beat the product is built around: the machines stop and ask. The
        hazard rule appears here and nowhere else on this screen.
      */}
      {settled ? (
        <div className="arriving mt-6">
          <div className="hazard-bar" />
          <div className="paper mt-3 p-4">
            <p className="eyebrow eyebrow--paper">Waiting for a person</p>
            <p className="mt-2 text-sm text-[var(--color-ink)]">
              Pay Meridian 232.00 USDC for one reefer container, Rotterdam to Mumbai.
            </p>
            <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
              Above the 200.00 USDC approval threshold. Nothing settles until you decide.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
