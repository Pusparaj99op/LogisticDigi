'use client';

import { useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { FadeUp } from '@/components/animations/FadeUp';

// Lazy load Lotties so they don't block paint
const Lottie = dynamic(() => import('lottie-react'), { ssr: false });
import inventoryAnim from '@/lotties/inventory.json';
import procurementAnim from '@/lotties/procurement.json';
import negotiationAnim from '@/lotties/negotiation.json';
import complianceAnim from '@/lotties/compliance.json';
import settlementAnim from '@/lotties/settlement.json';
import logisticsAnim from '@/lotties/logistics.json';

gsap.registerPlugin(ScrollTrigger);

const agents = [
  { name: 'Inventory', anim: inventoryAnim, perm: 'Read access to warehouse systems.', rest: 'Cannot execute purchases.' },
  { name: 'Procurement', anim: procurementAnim, perm: 'Search supplier catalogue via API.', rest: 'Cannot view internal margins.' },
  { name: 'Negotiation', anim: negotiationAnim, perm: 'Bargain with counterparty bots.', rest: 'Cannot agree above target price.' },
  { name: 'Compliance', anim: complianceAnim, perm: 'Veto any illegal or risky deal.', rest: 'Cannot initiate any deals.' },
  { name: 'Settlement', anim: settlementAnim, perm: 'Pay up to the strict budget cap.', rest: 'Cannot bypass human approval for overages.' },
  { name: 'Logistics', anim: logisticsAnim, perm: 'Book and track cargo routes.', rest: 'Cannot alter the settled invoice.' },
];

export default function HowItWorks() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const humanRef = useRef<HTMLDivElement>(null);
  
  useGSAP(() => {
    // Horizontal Timeline Scrub
    if (trackRef.current && timelineRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.innerWidth >= 768) {
      const steps = agents.length;
      gsap.to(trackRef.current, {
        xPercent: -(100 / steps) * (steps - 1.5), // Adjust based on viewport to leave some space
        ease: 'none',
        scrollTrigger: {
          trigger: timelineRef.current,
          pin: true,
          scrub: 1,
          end: '+=3000',
        }
      });
    }

    // Human in loop animation
    if (humanRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.from('.payment-card', {
        y: 100,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: humanRef.current,
          start: 'top 70%',
        }
      });

      gsap.to('.hazard-line', {
        opacity: 0.4,
        yoyo: true,
        repeat: -1,
        duration: 1.5,
        ease: 'sine.inOut'
      });
    }
  }, { scope: timelineRef });

  return (
    <div className="min-h-screen bg-[#0A0B0E] text-[#F3F4F6] font-[family-name:var(--font-inter)] selection:bg-[#FFC400] selection:text-[#0A0B0E]">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 max-w-6xl mx-auto text-center">
        <FadeUp>
          <h1 className="fade-up text-5xl md:text-7xl font-[family-name:var(--font-dm-serif)] mb-6 text-[#F3F4F6]">
            Six agents.<br/>
            <span className="text-[#FFC400]">One mandate.</span>
          </h1>
          <p className="fade-up text-lg md:text-xl text-[#6B7280] max-w-2xl mx-auto">
            The orchestrator delegates to specialists. Each has a narrow permission scope. None holds every key.
          </p>
        </FadeUp>
      </section>

      {/* Timeline Section */}
      <section ref={timelineRef} className="timeline-section relative h-screen flex items-center overflow-hidden bg-[#111318] border-y border-[#1E2128]">
        <div ref={trackRef} className="timeline-track flex flex-nowrap w-[600vw] md:w-[300vw] h-full items-center px-[10vw]">
          {agents.map((agent, i) => (
            <div key={agent.name} className="w-[80vw] md:w-[40vw] flex-shrink-0 px-6">
              <div className="bg-[#0A0B0E] border border-[#1E2128] rounded-xl p-8 shadow-2xl relative overflow-hidden group">
                {/* Number Watermark */}
                <div className="absolute -top-10 -right-10 text-[12rem] font-[family-name:var(--font-jetbrains-mono)] font-bold text-[#1E2128]/40 leading-none group-hover:text-[#FFC400]/10 transition-colors duration-500">
                  {i + 1}
                </div>
                <div className="relative z-10">
                  <div className="w-20 h-20 mb-6 bg-[#111318] rounded-lg border border-[#1E2128] flex items-center justify-center p-4">
                     <Lottie animationData={agent.anim} loop={true} className="w-full h-full" />
                  </div>
                  <h3 className="text-3xl font-[family-name:var(--font-dm-serif)] mb-6">{agent.name}</h3>
                  <div className="space-y-4 font-[family-name:var(--font-jetbrains-mono)] text-sm">
                    <div>
                      <span className="block text-[#6B7280] uppercase tracking-widest text-xs mb-1">Permission</span>
                      <span className="text-[#FFC400] flex items-start gap-2">
                        <span className="mt-1">✓</span> {agent.perm}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[#6B7280] uppercase tracking-widest text-xs mb-1">Restriction</span>
                      <span className="text-[#e5484d] flex items-start gap-2">
                        <span className="mt-1">✗</span> {agent.rest}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Human-in-the-Loop Section */}
      <section ref={humanRef} className="py-32 relative overflow-hidden bg-[#0A0B0E]">
        {/* Striped hazard background */}
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #F59E0B 0 12px, transparent 12px 24px)' }}></div>
        
        <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
          <FadeUp>
            <h2 className="fade-up text-4xl font-[family-name:var(--font-dm-serif)] mb-4">When logic meets limits</h2>
            <p className="fade-up text-[#6B7280] mb-16 text-lg">Agents halt and request a human signature when a threshold is breached.</p>
          </FadeUp>

          <div className="relative bg-[#111318] border border-[#1E2128] rounded-xl p-8 md:p-12 shadow-2xl max-w-2xl mx-auto">
            {/* Pulsing Hazard Line */}
            <div className="hazard-line absolute top-0 left-0 w-full h-2 bg-[#F59E0B]"></div>
            
            <div className="payment-card bg-white text-[#101114] p-6 rounded-sm shadow-xl font-[family-name:var(--font-inter)] text-left relative overflow-hidden">
               {/* Perforated edge effect */}
               <div className="absolute left-0 top-0 h-full w-4 bg-gradient-to-r from-transparent to-white" style={{ maskImage: 'radial-gradient(circle at 0px 50%, transparent 4px, black 4.5px)', WebkitMaskImage: 'radial-gradient(circle at 0px 50%, transparent 4px, black 4.5px)', maskSize: '100% 12px' }}></div>
               
               <div className="pl-6">
                 <div className="text-xs font-[family-name:var(--font-jetbrains-mono)] text-[#55565c] uppercase tracking-widest mb-4">Approval Request</div>
                 <div className="flex justify-between items-end mb-6 border-b border-gray-200 pb-4">
                   <div>
                     <div className="font-medium text-lg">Budget Exceeded</div>
                     <div className="text-gray-500 text-sm">Requested by: Settlement Agent</div>
                   </div>
                   <div className="text-2xl font-[family-name:var(--font-jetbrains-mono)] font-bold text-[#e5484d]">$14,500.00</div>
                 </div>
                 <div className="flex gap-4">
                   <button className="flex-1 py-3 bg-[#101114] text-white font-medium hover:bg-black transition-colors rounded-sm">Authorize</button>
                   <button className="flex-1 py-3 border border-gray-300 text-[#101114] font-medium hover:bg-gray-50 transition-colors rounded-sm">Veto</button>
                 </div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Algorand Settlement Section */}
      <section className="py-32 bg-[#111318] relative border-t border-[#1E2128]">
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#F3F4F6 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
        <div className="max-w-6xl mx-auto px-6 relative z-10">
          <FadeUp className="text-center mb-16">
            <h2 className="fade-up text-4xl font-[family-name:var(--font-dm-serif)] mb-4">Settled on Algorand</h2>
            <p className="fade-up text-[#6B7280] max-w-2xl mx-auto text-lg">Instant finality, fractional penny fees, and native USDC.</p>
          </FadeUp>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FadeUp className="col-span-1">
               <div className="fade-up bg-[#0A0B0E] p-8 border border-[#1E2128] rounded-xl h-full hover:border-[#FFC400]/50 transition-colors">
                  <div className="w-12 h-12 bg-[#FFC400]/10 rounded-lg flex items-center justify-center mb-6 text-[#FFC400]">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <h3 className="text-xl font-bold mb-3">HTTP 402 Native</h3>
                  <p className="text-[#6B7280] text-sm">Agents natively understand the HTTP 402 Payment Required status code to trigger settlement flows.</p>
               </div>
            </FadeUp>
            <FadeUp className="col-span-1">
               <div className="fade-up bg-[#0A0B0E] p-8 border border-[#1E2128] rounded-xl h-full hover:border-[#FFC400]/50 transition-colors" style={{ transitionDelay: '100ms' }}>
                  <div className="w-12 h-12 bg-[#FFC400]/10 rounded-lg flex items-center justify-center mb-6 text-[#FFC400]">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  </div>
                  <h3 className="text-xl font-bold mb-3">Single-use nonce</h3>
                  <p className="text-[#6B7280] text-sm">Every payment receipt is tied to a cryptographically secure, single-use nonce preventing replay attacks.</p>
               </div>
            </FadeUp>
            <FadeUp className="col-span-1">
               <div className="fade-up bg-[#0A0B0E] p-8 border border-[#1E2128] rounded-xl h-full hover:border-[#FFC400]/50 transition-colors" style={{ transitionDelay: '200ms' }}>
                  <div className="w-12 h-12 bg-[#FFC400]/10 rounded-lg flex items-center justify-center mb-6 text-[#FFC400]">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                  </div>
                  <h3 className="text-xl font-bold mb-3">Public explorer link</h3>
                  <p className="text-[#6B7280] text-sm">Auditable by default. Every transaction hash is written to the operations console for absolute transparency.</p>
               </div>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 bg-[#0A0B0E] border-t border-[#1E2128] text-center px-6">
        <FadeUp>
          <h2 className="fade-up text-4xl md:text-5xl font-[family-name:var(--font-dm-serif)] mb-8">Ready to deploy?</h2>
          <Link
            href="/sign-in"
            className="fade-up inline-block px-8 py-4 bg-[#FFC400] text-[#0A0B0E] font-medium rounded-md hover:bg-white transition-colors shadow-[0_0_20px_rgba(255,196,0,0.3)] hover:shadow-[0_0_30px_rgba(255,196,0,0.5)]"
          >
            Open the Console →
          </Link>
        </FadeUp>
      </section>

      <Footer />
    </div>
  );
}
