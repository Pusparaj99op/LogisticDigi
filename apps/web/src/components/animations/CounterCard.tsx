'use client';

import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface CounterCardProps {
  label: string;
  targetNumber: number;
  suffix?: string;
  className?: string;
}

export function CounterCard({ label, targetNumber, suffix = '', className = '' }: CounterCardProps) {
  const numberRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && numberRef.current) {
      gsap.to(numberRef.current, {
        innerHTML: targetNumber,
        duration: 2,
        ease: 'power2.out',
        snap: { innerHTML: 1 },
        scrollTrigger: { 
          trigger: containerRef.current, 
          start: 'top 80%' 
        },
        onUpdate: function() {
          if (numberRef.current) {
             numberRef.current.innerHTML = Math.round(Number(numberRef.current.innerHTML)).toString() + suffix;
          }
        }
      });
    } else if (numberRef.current) {
      numberRef.current.innerHTML = targetNumber.toString() + suffix;
    }
  }, { scope: containerRef });

  return (
    <div ref={containerRef} className={`bg-[#111318] border border-[#1E2128] p-6 rounded-md ${className}`}>
      <div className="font-[family-name:var(--font-jetbrains-mono)] text-4xl text-[#F3F4F6] mb-2 font-bold" ref={numberRef}>
        0{suffix}
      </div>
      <div className="text-sm text-[#6B7280] font-medium">{label}</div>
    </div>
  );
}
