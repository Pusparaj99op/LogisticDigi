'use client';

/**
 * HeroIntro — automatic loading-screen animation powered by ScrollExpand.
 *
 * Instead of wiring the frame expansion to scroll, we drive it with a
 * requestAnimationFrame loop that runs for a fixed duration.  The overlay
 * mounts on top of the full page, expands the frame, shows the logotype and
 * tagline, then fades the whole thing out and unmounts — leaving the landing
 * page underneath.
 *
 * Palette: project design tokens
 *   void      #0b0b0c   — background behind the resting frame
 *   hazard    #ffc400   — accent / tagline colour
 *   chalk     #f2f2f0   — headline text
 *   steel     #17181b   — subtle inner surface
 *
 * Typography:
 *   Archivo (display)   — headlines, uppercase, wide axis
 *   IBM Plex Mono       — eyebrow / hint labels
 */

import { useEffect, useRef, useState } from 'react';
import './HeroIntro.css';

/* ── timing constants ─────────────────────────────────────────────────────── */
const HOLD_MS   = 700;   // pause at rest before expansion starts
const EXPAND_MS = 1800;  // frame-expansion phase
const SHOW_MS   = 900;   // hold at full-bleed
const FADE_MS   = 600;   // overlay fade-out

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
};

/* ── geometry defaults (mirrors ScrollExpand defaults) ────────────────────── */
const START_W  = 42;   // % width of resting frame
const START_H  = 58;   // % height of resting frame
const START_R  = 24;   // px corner radius at rest
const END_R    = 0;    // px corner radius at full-bleed
const ZOOM     = 1.35; // media zoom at rest

export function HeroIntro({ onDone }: { onDone?: () => void }) {
  // Typed explicitly because a bare useRef(null) infers `null`, which makes
  // every `.style` access below an error under this repo's strict config.
  // All seven are attached to div elements.
  const frameRef  = useRef<HTMLDivElement | null>(null);
  const mediaRef  = useRef<HTMLDivElement | null>(null);
  const scrimRef  = useRef<HTMLDivElement | null>(null);
  const titleRef  = useRef<HTMLDivElement | null>(null);
  const hintRef   = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rootRef   = useRef<HTMLDivElement | null>(null);

  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* Skip entirely if user prefers reduced motion */
    if (reduceMotion) {
      setVisible(false);
      onDone?.();
      return;
    }

    let raf = 0;
    const startTime = performance.now();
    const totalActive = HOLD_MS + EXPAND_MS + SHOW_MS;

    const applyProgress = (p: number) => {
      const frame = frameRef.current;
      const media = mediaRef.current;
      if (!frame || !media) return;

      const e = smoothstep(0, 1, p);
      const w  = START_W + (100 - START_W) * e;
      const h  = START_H + (100 - START_H) * e;
      const ix = Math.max(0, (100 - w) / 2);
      const iy = Math.max(0, (100 - h) / 2);
      const r  = START_R + (END_R - START_R) * e;
      frame.style.clipPath = `inset(${iy}% ${ix}% ${iy}% ${ix}% round ${r}px)`;

      media.style.transform = `scale(${ZOOM + (1 - ZOOM) * e})`;

      if (scrimRef.current)  scrimRef.current.style.opacity  = `${0.55 * e}`;

      /* title lifts & fades out past 40 % progress */
      if (titleRef.current) {
        const out = smoothstep(0.38, 0.82, p);
        titleRef.current.style.opacity   = `${1 - out}`;
        titleRef.current.style.transform = `translate3d(0,${-32 * out}px,0) scale(${1 + 0.06 * out})`;
      }

      /* hint disappears in the first 12 % */
      if (hintRef.current) {
        const gone = smoothstep(0, 0.12, p);
        hintRef.current.style.opacity   = `${1 - gone}`;
        hintRef.current.style.transform = `translate3d(0,${8 * gone}px,0)`;
      }

      /* overlay content appears after 70 % */
      if (overlayRef.current) {
        const inn = smoothstep(0.70, 1, p);
        overlayRef.current.style.opacity   = `${inn}`;
        overlayRef.current.style.transform = `translate3d(0,${20 * (1 - inn)}px,0)`;
      }
    };

    /* seed the resting frame */
    applyProgress(0);

    const tick = (now: number) => {
      const elapsed = now - startTime;

      if (elapsed < HOLD_MS) {
        /* still in the hold phase — frame stays at rest */
        applyProgress(0);
        raf = requestAnimationFrame(tick);
        return;
      }

      const expandElapsed = elapsed - HOLD_MS;
      const p = Math.min(expandElapsed / EXPAND_MS, 1);
      applyProgress(p);

      if (elapsed < totalActive) {
        raf = requestAnimationFrame(tick);
        return;
      }

      /* Expansion done — fade the whole overlay out */
      const root = rootRef.current;
      if (root) {
        root.style.transition = `opacity ${FADE_MS}ms ease`;
        root.style.opacity    = '0';
      }

      setTimeout(() => {
        setVisible(false);
        onDone?.();
      }, FADE_MS);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  if (!visible) return null;

  return (
    <div ref={rootRef} className="hero-intro" aria-hidden>
      {/* ── background behind the resting frame ── */}
      <div className="hero-intro__bg" />

      {/* ── the expanding frame ── */}
      <div ref={frameRef} className="hero-intro__frame">
        {/* Gradient background replacing a real image — warehouse-floor aesthetic */}
        <div ref={mediaRef} className="hero-intro__media" />
        <div ref={scrimRef} className="hero-intro__scrim" />

        {/* Content that appears at full-bleed */}
        <div ref={overlayRef} className="hero-intro__overlay">
          <p className="hero-intro__eyebrow">LogisticDigi · INF-03</p>
          <h2 className="hero-intro__overlay-headline">
            Agents negotiate.<br />
            <span className="hero-intro__accent">You decide.</span>
          </h2>
          <p className="hero-intro__overlay-body">
            Composite agentic commerce orchestrator for warehouse, inventory, and freight networks.
          </p>
        </div>
      </div>

      {/* ── resting-frame title ── */}
      <div ref={titleRef} className="hero-intro__title">
        LogisticDigi
      </div>

      {/* ── subtle hint ── */}
      <div ref={hintRef} className="hero-intro__hint">
        Loading
      </div>
    </div>
  );
}
