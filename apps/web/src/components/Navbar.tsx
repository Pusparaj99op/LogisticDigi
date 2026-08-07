'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const links = [
  { name: 'Home', path: '/' },
  { name: 'How It Works', path: '/how-it-works' },
  { name: 'Evaluation', path: '/evaluation' },
  { name: 'Architecture', path: '/architecture' },
  { name: 'Use Cases', path: '/use-cases' },
];

export function Navbar() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (!navRef.current) return;
    
    // Add shadow on scroll
    ScrollTrigger.create({
      start: 'top -80',
      end: 99999,
      toggleClass: { className: 'shadow-md', targets: navRef.current },
    });
  }, { scope: navRef });

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-50 w-full backdrop-blur-md bg-[#0A0B0E]/80 border-b border-[#1E2128] transition-shadow duration-300 font-[family-name:var(--font-inter)] text-[#F3F4F6]"
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-[family-name:var(--font-dm-serif)] text-xl tracking-wide flex items-center gap-2">
          <span className="w-4 h-4 bg-[#6EE7B7] block rounded-sm"></span>
          LogisticDigi
        </Link>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-8 text-sm font-medium">
          {links.map((link) => {
            const isActive = pathname === link.path;
            return (
              <Link key={link.path} href={link.path} className="relative group text-[#6B7280] hover:text-[#F3F4F6] transition-colors">
                {link.name}
                <div
                  className={`absolute -bottom-1 left-0 h-0.5 bg-[#6EE7B7] transition-all duration-300 ease-out ${
                    isActive ? 'w-full' : 'w-0 group-hover:w-full'
                  }`}
                />
              </Link>
            );
          })}
          <Link
            href="/sign-in"
            className="ml-4 px-4 py-2 bg-[#111318] border border-[#1E2128] rounded-md hover:bg-[#1E2128] transition-colors text-[#F3F4F6]"
          >
            Open Console →
          </Link>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden p-2 text-[#F3F4F6]"
          onClick={() => setIsMobileMenuOpen(true)}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
          </svg>
        </button>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end md:hidden">
          <div
            className="fixed inset-0 bg-[#0A0B0E]/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative w-64 bg-[#111318] h-full border-l border-[#1E2128] p-6 flex flex-col gap-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <span className="font-[family-name:var(--font-dm-serif)] text-lg">Menu</span>
              <button onClick={() => setIsMobileMenuOpen(false)} className="text-[#6B7280] hover:text-[#F3F4F6]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {links.map((link) => (
              <Link
                key={link.path}
                href={link.path}
                className={`text-lg font-medium transition-colors ${
                  pathname === link.path ? 'text-[#6EE7B7]' : 'text-[#6B7280] hover:text-[#F3F4F6]'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {link.name}
              </Link>
            ))}
            <div className="mt-auto border-t border-[#1E2128] pt-6">
              <Link
                href="/sign-in"
                className="w-full text-center block px-4 py-3 bg-[#6EE7B7] text-[#0A0B0E] font-medium rounded-md hover:opacity-90 transition-opacity"
              >
                Open Console →
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
