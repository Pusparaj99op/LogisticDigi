'use client';

import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function DrawPath({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.from('.arrow', {
        strokeDashoffset: 200,
        strokeDasharray: 200,
        duration: 1.2,
        ease: 'power2.inOut',
        stagger: 0.2,
        scrollTrigger: { 
          trigger: containerRef.current, 
          start: 'top 70%' 
        }
      });
    }
  }, { scope: containerRef });

  return (
    <div ref={containerRef} className={className} id="agent-graph">
      {children}
    </div>
  );
}
