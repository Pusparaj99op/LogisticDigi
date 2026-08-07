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
import warehouseAnim from '@/public/lotties/warehouse.json';
import globeAnim from '@/public/lotties/globe.json';
import liquidationAnim from '@/public/lotties/liquidation.json';
import shieldAnim from '@/public/lotties/shield.json';
import alertAnim from '@/public/lotties/alert.json';
import handshakeAnim from '@/public/lotties/handshake-three.json';

gsap.registerPlugin(ScrollTrigger);

const useCases = [
  { title: 'Perishable Goods Procurement', desc: 'Time-critical surplus matching before expiry. Compliance agent verifies freshness certificates.', scope: ['Procurement', 'Compliance', 'Settlement'], anim: warehouseAnim },
  { title: 'Cross-Border Freight Coordination', desc: 'Multi-leg logistics booking across borders. Compliance agent blocks if customs documents fail validation.', scope: ['Logistics', 'Compliance', 'Settlement'], anim: globeAnim },
  { title: 'Surplus Liquidation', desc: 'Seller-side agent matches with network buyers and settles atomic transactions in USDC.', scope: ['Inventory', 'Negotiation', 'Settlement'], anim: liquidationAnim },
  { title: 'Supplier Vetting', desc: 'Compliance agent autonomously pre-screens supplier databases against sanctions lists before negotiation.', scope: ['Procurement', 'Compliance'], anim: shieldAnim },
  { title: 'Emergency Restocking', desc: 'Inventory agent detects threshold breaches and triggers procurement agent automatically.', scope: ['Inventory', 'Procurement', 'Logistics'], anim: alertAnim },
  { title: 'Multi-Party Settlement', desc: 'Complex three-way deals orchestrated into a single atomic settlement round on Algorand.', scope: ['Negotiation', 'Settlement'], anim: handshakeAnim },
];

const quotes = [
  { text: "We used to lose 15% of our surplus to expiry because matching buyers took a week. The agents clear it in 45 minutes.", author: "Sarah Jenkins", role: "VP of Operations, NovaFreight" },
  { text: "The compliance veto is airtight. If a supplier certificate doesn't match the hash on the registry, the settlement agent physically cannot release the USDC.", author: "Michael Chen", role: "Director of Logistics, Aerocorp" },
  { text: "It feels like we hired an army of procurement specialists who don't sleep, don't ask for weekends, and never spend past the budget.", author: "Elena Rodriguez", role: "Head of Supply Chain, Meridian Group" },
  { text: "We wired the planner agent to our ERP. When stock dips, it negotiates restocking before humans even open the dashboard.", author: "David Kim", role: "Chief Operating Officer, Sentinel Trade" }
];

export default function UseCases() {
  const carouselRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    // Horizontal Timeline Scrub for Quotes
    if (trackRef.current && carouselRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.innerWidth >= 768) {
      gsap.to(trackRef.current, {
        xPercent: -50, // Move track to left
        ease: 'none',
        scrollTrigger: {
          trigger: carouselRef.current,
          pin: true,
          scrub: 1,
          end: '+=2000',
        }
      });
    }
  }, { scope: carouselRef });

  return (
    <div className="min-h-screen bg-[#0A0B0E] text-[#F3F4F6] font-[family-name:var(--font-inter)] selection:bg-[#6EE7B7] selection:text-[#0A0B0E]">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 max-w-6xl mx-auto text-center border-b border-[#1E2128]">
        <FadeUp>
          <h1 className="fade-up text-5xl md:text-7xl font-[family-name:var(--font-dm-serif)] mb-6 text-[#F3F4F6]">
            The floor <span className="text-[#6EE7B7]">never sleeps.</span>
          </h1>
          <p className="fade-up text-lg md:text-xl text-[#6B7280] max-w-2xl mx-auto">
            24/7 automated procurement and logistics coordination that obeys your absolute constraints.
          </p>
        </FadeUp>
      </section>

      {/* Use Cases Grid */}
      <section className="py-24 max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 card-grid">
          {useCases.map((uc, i) => (
            <div key={i} className="group bg-[#111318] border border-[#1E2128] rounded-xl p-8 hover:border-[#6EE7B7]/50 hover:shadow-[0_0_30px_rgba(110,231,183,0.1)] transition-all duration-300 flex flex-col h-full">
               <div className="w-16 h-16 bg-[#0A0B0E] rounded-lg border border-[#1E2128] flex items-center justify-center p-3 mb-6">
                 <Lottie animationData={uc.anim} loop={true} className="w-full h-full" />
               </div>
               <h3 className="text-xl font-[family-name:var(--font-dm-serif)] mb-3">{uc.title}</h3>
               <p className="text-[#6B7280] text-sm mb-6 flex-grow">{uc.desc}</p>
               
               <div>
                 <div className="text-[10px] text-[#6B7280] uppercase tracking-widest mb-3">Permission Scope</div>
                 <div className="flex flex-wrap gap-2">
                   {uc.scope.map(s => (
                     <span key={s} className="px-2 py-1 bg-[#1E2128] text-xs font-[family-name:var(--font-jetbrains-mono)] rounded text-[#6B7280] group-hover:text-[#F3F4F6] transition-colors">{s}</span>
                   ))}
                 </div>
               </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quote Carousel */}
      <section ref={carouselRef} className="carousel-section relative h-screen flex items-center overflow-hidden bg-[#111318] border-y border-[#1E2128]">
        {/* Decorative quotes icon */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[30rem] font-serif text-[#1E2128]/20 select-none z-0">
          "
        </div>
        
        <div ref={trackRef} className="carousel-track flex flex-nowrap w-[200vw] h-full items-center px-[10vw] relative z-10 gap-[10vw]">
          {quotes.map((quote, i) => (
            <div key={i} className="w-[80vw] md:w-[40vw] flex-shrink-0">
              <blockquote className="text-2xl md:text-4xl font-[family-name:var(--font-dm-serif)] leading-snug mb-8">
                "{quote.text}"
              </blockquote>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#1E2128] rounded-full border border-[#6EE7B7]/30"></div>
                <div>
                  <div className="font-medium text-[#F3F4F6]">{quote.author}</div>
                  <div className="text-[#6B7280] text-sm font-[family-name:var(--font-jetbrains-mono)]">{quote.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 bg-[#0A0B0E] border-t border-[#1E2128] text-center px-6">
        <FadeUp>
          <h2 className="fade-up text-4xl md:text-5xl font-[family-name:var(--font-dm-serif)] mb-8">Set them loose.</h2>
          <Link
            href="/sign-in"
            className="fade-up inline-block px-8 py-4 bg-[#6EE7B7] text-[#0A0B0E] font-medium rounded-md hover:bg-white transition-colors shadow-[0_0_20px_rgba(110,231,183,0.3)] hover:shadow-[0_0_30px_rgba(110,231,183,0.5)]"
          >
            Open the Console →
          </Link>
        </FadeUp>
      </section>

      <Footer />
    </div>
  );
}
