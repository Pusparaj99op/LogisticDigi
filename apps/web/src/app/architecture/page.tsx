'use client';

import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { FadeUp } from '@/components/animations/FadeUp';
import { DrawPath } from '@/components/animations/DrawPath';

gsap.registerPlugin(ScrollTrigger);

const permissions = [
  { agent: 'Planner', readStock: false, writeStock: false, searchCat: false, negotiate: false, pay: false, book: false, veto: false },
  { agent: 'Inventory', readStock: true, writeStock: false, searchCat: false, negotiate: false, pay: false, book: false, veto: false },
  { agent: 'Procurement', readStock: false, writeStock: false, searchCat: true, negotiate: false, pay: false, book: false, veto: false },
  { agent: 'Negotiation', readStock: false, writeStock: false, searchCat: false, negotiate: true, pay: false, book: false, veto: false },
  { agent: 'Compliance', readStock: true, writeStock: false, searchCat: false, negotiate: false, pay: false, book: false, veto: true },
  { agent: 'Settlement', readStock: false, writeStock: true, searchCat: false, negotiate: false, pay: true, book: false, veto: true },
  { agent: 'Logistics', readStock: false, writeStock: false, searchCat: false, negotiate: false, pay: false, book: true, veto: false },
];

export default function Architecture() {
  const tokenFlowRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<HTMLTableElement>(null);

  useGSAP(() => {
    // Permission Matrix Stagger
    if (matrixRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.from('tr.stagger-row', {
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.05,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: matrixRef.current,
          start: 'top 85%',
        }
      });
    }

    // Token Flow Animation
    if (tokenFlowRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: tokenFlowRef.current,
          start: 'top 60%',
          toggleActions: 'play none none reverse'
        }
      });
      
      tl.to('.anim-token', { x: '16.6%', duration: 1, ease: 'power2.inOut' }) // Request -> 402
        .to('.anim-token', { x: '33.3%', duration: 1, ease: 'power2.inOut' }) // 402 -> Threshold
        .to('.anim-token', { y: -50, duration: 0.5, ease: 'power1.out' }) // Ask human
        .to('.anim-token', { x: '66.6%', duration: 1, ease: 'power2.inOut' }) // Approved -> Pay
        .to('.anim-token', { y: 0, duration: 0.5, ease: 'power1.in' }) // Back to track
        .to('.anim-token', { x: '83.3%', duration: 1, ease: 'power2.inOut' }); // Pay -> Chain
    }
  }, { scope: tokenFlowRef });

  return (
    <div className="min-h-screen bg-[#0A0B0E] text-[#F3F4F6] font-[family-name:var(--font-inter)] selection:bg-[#6EE7B7] selection:text-[#0A0B0E]">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 max-w-6xl mx-auto text-center">
        <FadeUp>
          <h1 className="fade-up text-5xl md:text-7xl font-[family-name:var(--font-dm-serif)] mb-6 text-[#F3F4F6]">
            No agent holds <span className="text-[#6EE7B7]">every key.</span>
          </h1>
          <p className="fade-up text-lg md:text-xl text-[#6B7280] max-w-2xl mx-auto">
            A zero-trust multi-agent orchestration architecture. Funds cannot be moved without independent verification.
          </p>
        </FadeUp>
      </section>

      {/* Agent Graph Diagram */}
      <section className="py-24 bg-[#111318] border-y border-[#1E2128] overflow-hidden">
        <div className="max-w-4xl mx-auto px-6 relative">
          <FadeUp>
             <h2 className="fade-up text-3xl font-[family-name:var(--font-dm-serif)] mb-12 text-center">Agent Topology</h2>
          </FadeUp>
          <DrawPath className="w-full h-96 relative flex items-center justify-center">
            {/* Center Node */}
            <div className="absolute z-10 bg-[#0A0B0E] border-2 border-[#1E2128] w-40 h-40 rounded-full flex flex-col items-center justify-center shadow-[0_0_30px_rgba(30,33,40,0.5)]">
               <span className="font-[family-name:var(--font-dm-serif)] text-xl text-white">Planner</span>
               <span className="text-[10px] text-[#6B7280] uppercase tracking-widest mt-1">Zero Tools</span>
            </div>

            {/* Specialist Nodes & Lines */}
            <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#6EE7B7" />
                </marker>
              </defs>
              
              {/* Top Left - Inventory */}
              <path className="arrow" d="M 50%,50% L 20%,20%" stroke="#6EE7B7" strokeWidth="2" fill="none" strokeDasharray="200" strokeDashoffset="0" markerEnd="url(#arrowhead)" />
              <foreignObject x="10%" y="10%" width="120" height="60" className="overflow-visible">
                <div className="bg-[#111318] border border-[#1E2128] rounded px-3 py-2 text-center text-sm absolute -translate-x-1/2 -translate-y-1/2 shadow-lg">Inventory</div>
                <div className="text-[10px] text-[#6EE7B7] bg-[#0A0B0E] px-1 absolute -translate-x-1/2 translate-y-4">Tasks only</div>
              </foreignObject>

              {/* Top Right - Procurement */}
              <path className="arrow" d="M 50%,50% L 80%,20%" stroke="#6EE7B7" strokeWidth="2" fill="none" strokeDasharray="200" strokeDashoffset="0" markerEnd="url(#arrowhead)" />
              <foreignObject x="90%" y="10%" width="120" height="60" className="overflow-visible">
                <div className="bg-[#111318] border border-[#1E2128] rounded px-3 py-2 text-center text-sm absolute -translate-x-1/2 -translate-y-1/2 shadow-lg">Procurement</div>
                <div className="text-[10px] text-[#6EE7B7] bg-[#0A0B0E] px-1 absolute -translate-x-1/2 translate-y-4">Tasks only</div>
              </foreignObject>

              {/* Left - Negotiation */}
              <path className="arrow" d="M 50%,50% L 15%,50%" stroke="#6EE7B7" strokeWidth="2" fill="none" strokeDasharray="200" strokeDashoffset="0" markerEnd="url(#arrowhead)" />
              <foreignObject x="5%" y="50%" width="120" height="60" className="overflow-visible">
                <div className="bg-[#111318] border border-[#1E2128] rounded px-3 py-2 text-center text-sm absolute -translate-x-1/2 -translate-y-1/2 shadow-lg">Negotiation</div>
                <div className="text-[10px] text-[#6EE7B7] bg-[#0A0B0E] px-1 absolute -translate-x-1/2 translate-y-4">Tasks only</div>
              </foreignObject>

              {/* Right - Compliance */}
              <path className="arrow" d="M 50%,50% L 85%,50%" stroke="#6EE7B7" strokeWidth="2" fill="none" strokeDasharray="200" strokeDashoffset="0" markerEnd="url(#arrowhead)" />
              <foreignObject x="95%" y="50%" width="120" height="60" className="overflow-visible">
                <div className="bg-[#111318] border border-[#1E2128] rounded px-3 py-2 text-center text-sm absolute -translate-x-1/2 -translate-y-1/2 shadow-lg">Compliance</div>
                <div className="text-[10px] text-[#6EE7B7] bg-[#0A0B0E] px-1 absolute -translate-x-1/2 translate-y-4">Tasks only</div>
              </foreignObject>

              {/* Bottom Left - Settlement */}
              <path className="arrow" d="M 50%,50% L 20%,80%" stroke="#6EE7B7" strokeWidth="2" fill="none" strokeDasharray="200" strokeDashoffset="0" markerEnd="url(#arrowhead)" />
              <foreignObject x="10%" y="90%" width="120" height="60" className="overflow-visible">
                <div className="bg-[#111318] border border-[#1E2128] rounded px-3 py-2 text-center text-sm absolute -translate-x-1/2 -translate-y-1/2 shadow-lg">Settlement</div>
                <div className="text-[10px] text-[#6EE7B7] bg-[#0A0B0E] px-1 absolute -translate-x-1/2 translate-y-4">Tasks only</div>
              </foreignObject>

              {/* Bottom Right - Logistics */}
              <path className="arrow" d="M 50%,50% L 80%,80%" stroke="#6EE7B7" strokeWidth="2" fill="none" strokeDasharray="200" strokeDashoffset="0" markerEnd="url(#arrowhead)" />
              <foreignObject x="90%" y="90%" width="120" height="60" className="overflow-visible">
                <div className="bg-[#111318] border border-[#1E2128] rounded px-3 py-2 text-center text-sm absolute -translate-x-1/2 -translate-y-1/2 shadow-lg">Logistics</div>
                <div className="text-[10px] text-[#6EE7B7] bg-[#0A0B0E] px-1 absolute -translate-x-1/2 translate-y-4">Tasks only</div>
              </foreignObject>

            </svg>
          </DrawPath>
        </div>
      </section>

      {/* Permission Matrix */}
      <section className="py-24 max-w-6xl mx-auto px-6 overflow-hidden">
        <FadeUp>
          <h2 className="fade-up text-3xl font-[family-name:var(--font-dm-serif)] mb-12">Permission Matrix</h2>
        </FadeUp>
        
        <div className="overflow-x-auto">
          <table ref={matrixRef} className="w-full text-center border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#1E2128] font-[family-name:var(--font-jetbrains-mono)] text-xs text-[#6B7280] uppercase tracking-wider">
                <th className="pb-4 text-left font-medium">Agent</th>
                <th className="pb-4 font-medium px-2">Read Stock</th>
                <th className="pb-4 font-medium px-2">Write Stock</th>
                <th className="pb-4 font-medium px-2">Search Cat</th>
                <th className="pb-4 font-medium px-2">Negotiate</th>
                <th className="pb-4 font-medium px-2">Pay</th>
                <th className="pb-4 font-medium px-2">Book Freight</th>
                <th className="pb-4 font-medium px-2">Veto</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((p, i) => (
                <tr key={i} className="stagger-row border-b border-[#1E2128]/50 hover:bg-[#111318] transition-colors h-14">
                  <td className="text-left font-medium text-[#F3F4F6]">{p.agent}</td>
                  <td>{p.readStock ? <span className="text-[#6EE7B7]">✓</span> : <span className="text-[#e5484d]">✗</span>}</td>
                  <td>{p.writeStock ? <span className="text-[#6EE7B7]">✓</span> : <span className="text-[#e5484d]">✗</span>}</td>
                  <td>{p.searchCat ? <span className="text-[#6EE7B7]">✓</span> : <span className="text-[#e5484d]">✗</span>}</td>
                  <td>{p.negotiate ? <span className="text-[#6EE7B7]">✓</span> : <span className="text-[#e5484d]">✗</span>}</td>
                  <td>{p.pay ? <span className="text-[#6EE7B7]">✓</span> : <span className="text-[#e5484d]">✗</span>}</td>
                  <td>{p.book ? <span className="text-[#6EE7B7]">✓</span> : <span className="text-[#e5484d]">✗</span>}</td>
                  <td>{p.veto ? <span className="text-[#6EE7B7]">✓</span> : <span className="text-[#e5484d]">✗</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* HTTP 402 Flow */}
      <section ref={tokenFlowRef} className="py-24 bg-[#111318] border-y border-[#1E2128] overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 relative">
           <FadeUp>
             <h2 className="fade-up text-3xl font-[family-name:var(--font-dm-serif)] mb-16 text-center">The HTTP 402 Settlement Flow</h2>
           </FadeUp>
           
           <div className="relative h-64 font-[family-name:var(--font-jetbrains-mono)] text-xs text-center w-full">
              {/* Path Line */}
              <div className="absolute top-1/2 left-0 w-full h-[2px] bg-[#1E2128] -translate-y-1/2 z-0"></div>
              
              {/* Human Approval Path */}
              <div className="absolute top-1/2 left-1/3 w-1/3 h-16 border-t-2 border-dashed border-[#F59E0B] -translate-y-full z-0 rounded-t-xl opacity-50">
                <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[#F59E0B]">Human Review</span>
              </div>

              {/* Token */}
              <div className="anim-token absolute top-1/2 left-0 w-12 h-12 bg-[#6EE7B7] rounded-full shadow-[0_0_20px_rgba(110,231,183,0.6)] -translate-y-1/2 -translate-x-1/2 z-20 flex items-center justify-center text-[#0A0B0E] font-bold text-lg">
                $
              </div>

              {/* Steps */}
              <div className="absolute top-1/2 left-0 -translate-y-1/2 -translate-x-1/2 z-10 bg-[#0A0B0E] border border-[#1E2128] p-3 rounded-lg mt-16 w-32">Agent Requests Resource</div>
              <div className="absolute top-1/2 left-[16.6%] -translate-y-1/2 -translate-x-1/2 z-10 bg-[#0A0B0E] border border-[#1E2128] p-3 rounded-lg mt-16 w-32 text-[#e5484d]">Server returns HTTP 402</div>
              <div className="absolute top-1/2 left-[33.3%] -translate-y-1/2 -translate-x-1/2 z-10 bg-[#0A0B0E] border border-[#1E2128] p-3 rounded-lg mt-16 w-32">Checks Threshold</div>
              <div className="absolute top-1/2 left-[66.6%] -translate-y-1/2 -translate-x-1/2 z-10 bg-[#0A0B0E] border border-[#1E2128] p-3 rounded-lg mt-16 w-32 text-[#F59E0B]">Human Approves</div>
              <div className="absolute top-1/2 left-[83.3%] -translate-y-1/2 -translate-x-1/2 z-10 bg-[#0A0B0E] border border-[#1E2128] p-3 rounded-lg mt-16 w-32 text-[#6EE7B7]">Agent Pays USDC</div>
              <div className="absolute top-1/2 left-[100%] -translate-y-1/2 -translate-x-1/2 z-10 bg-[#0A0B0E] border border-[#1E2128] p-3 rounded-lg mt-16 w-32">Nonce on chain</div>
           </div>
        </div>
      </section>

      {/* Algorand Integration */}
      <section className="py-24 max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <FadeUp>
            <h2 className="fade-up text-3xl font-[family-name:var(--font-dm-serif)] mb-6">Why Algorand?</h2>
            <ul className="fade-up space-y-4 text-[#6B7280]">
              <li className="flex items-start gap-3"><span className="text-[#6EE7B7] mt-1">✓</span> <strong>Sub-second finality.</strong> Agents cannot wait 10 minutes for block confirmations. They need to pay and instantly consume an API.</li>
              <li className="flex items-start gap-3"><span className="text-[#6EE7B7] mt-1">✓</span> <strong>Fractional penny fees.</strong> Micro-transactions for API calls are economically viable when fees are $0.0001.</li>
              <li className="flex items-start gap-3"><span className="text-[#6EE7B7] mt-1">✓</span> <strong>Testnet Parity.</strong> We evaluate safely on TestNet before moving to MainNet with identical smart contract execution.</li>
              <li className="flex items-start gap-3"><span className="text-[#6EE7B7] mt-1">✓</span> <strong>USDC Native.</strong> B2B commerce settles in dollars, not volatile tokens. Algorand's native USDC asset enables stable negotiation.</li>
            </ul>
          </FadeUp>
          
          <FadeUp>
            <div className="fade-up bg-[#111318] border border-[#1E2128] p-6 rounded-xl shadow-2xl font-[family-name:var(--font-jetbrains-mono)] text-sm overflow-x-auto relative group">
               <div className="absolute top-4 right-4 w-3 h-3 rounded-full bg-[#6EE7B7] animate-pulse"></div>
               <div className="text-[#6B7280] mb-4 uppercase tracking-widest text-xs">Transaction Receipt</div>
               <pre className="text-[#F3F4F6]">
                 <code>
                   <span className="text-[#6EE7B7]">TXID:</span> OMQYZ6R...9PLD<br/>
                   <span className="text-[#6EE7B7]">FROM:</span> GZ4K7...L2P<br/>
                   <span className="text-[#6EE7B7]">TO:</span>   A7WQ2...M8J<br/>
                   <br/>
                   <span className="text-[#F59E0B]">ASSET:</span> 10458941 (USDC)<br/>
                   <span className="text-[#F59E0B]">AMT:</span>   14,500.00<br/>
                   <span className="text-[#F59E0B]">FEE:</span>   0.001 ALGO<br/>
                   <br/>
                   <span className="text-[#6B7280]">NOTE (NONCE):</span><br/>
                   "5e884898da28047151d0e56f8dc62927"<br/>
                   <br/>
                   <span className="text-[#6EE7B7]">[ STATUS: CONFIRMED_ROUND_310842 ]</span>
                 </code>
               </pre>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="py-24 bg-[#111318] border-t border-[#1E2128]">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <FadeUp>
             <h2 className="fade-up text-xl font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-widest text-[#6B7280] mb-12">The Stack</h2>
          </FadeUp>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            {['Next.js', 'Algorand', 'USDC', 'TypeScript', 'Vercel'].map((tech) => (
              <div key={tech} className="bg-[#0A0B0E] border border-[#1E2128] p-6 rounded-lg text-[#F3F4F6] font-medium hover:-translate-y-2 transition-transform duration-300 shadow-xl">
                {tech}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
