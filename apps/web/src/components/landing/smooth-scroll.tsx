'use client';

/**
 * Lenis smooth scrolling, driven by GSAP's ticker.
 *
 * Running Lenis off its own requestAnimationFrame loop while ScrollTrigger
 * runs off GSAP's produces two clocks and visible drift on scrubbed
 * animations. Driving Lenis from the GSAP ticker keeps a single clock, which
 * is what makes pinned sections track the scrollbar exactly.
 *
 * Disabled entirely under prefers-reduced-motion: hijacking the scroll is
 * precisely the kind of motion someone with that setting is asking to avoid.
 */

import { useEffect, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({ duration: 1.05, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
