import Link from 'next/link';

const links = [
  { name: 'Home', path: '/' },
  { name: 'How It Works', path: '/how-it-works' },
  { name: 'Evaluation', path: '/evaluation' },
  { name: 'Architecture', path: '/architecture' },
  { name: 'Use Cases', path: '/use-cases' },
];

export function Footer() {
  return (
    <footer className="bg-[#111318] border-t border-[#1E2128] pt-16 pb-8 font-[family-name:var(--font-inter)] text-[#6B7280]">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-12 mb-16">
        
        {/* Left: Brand */}
        <div className="flex flex-col items-start gap-4">
          <Link href="/" className="font-[family-name:var(--font-dm-serif)] text-2xl tracking-wide flex items-center gap-2 text-[#F3F4F6]">
            <span className="w-5 h-5 bg-[#6EE7B7] block rounded-sm"></span>
            LogisticDigi
          </Link>
          <p className="text-sm">Agents negotiate. You decide.</p>
          <p className="text-xs text-[#F59E0B]/80 mt-2 px-3 py-1 bg-[#F59E0B]/10 rounded-full border border-[#F59E0B]/20">
            Built on Algorand TestNet. No real funds move.
          </p>
        </div>

        {/* Middle: Links */}
        <div className="flex flex-col gap-3 md:items-center">
          <h4 className="text-[#F3F4F6] font-medium mb-2">Navigation</h4>
          {links.map((link) => (
            <Link key={link.path} href={link.path} className="hover:text-[#6EE7B7] transition-colors text-sm">
              {link.name}
            </Link>
          ))}
        </div>

        {/* Right: CTA & Metadata */}
        <div className="flex flex-col gap-4 md:items-end text-left md:text-right">
          <Link
            href="/sign-in"
            className="px-6 py-3 bg-[#111318] border border-[#1E2128] rounded-md hover:bg-[#1E2128] hover:border-[#6EE7B7]/50 transition-all text-[#F3F4F6] text-sm font-medium shadow-[0_0_15px_rgba(110,231,183,0)] hover:shadow-[0_0_15px_rgba(110,231,183,0.1)] inline-block w-fit md:w-auto"
          >
            Open the Console →
          </Link>
          <p className="text-xs mt-4 max-w-[200px]">
            Built for the agentic commerce track.
          </p>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-[#F3F4F6] transition-colors">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="max-w-6xl mx-auto px-6 border-t border-[#1E2128] pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs">
        <p>© {new Date().getFullYear()} LogisticDigi. All rights reserved.</p>
        <p className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#6EE7B7] animate-pulse"></span>
          Demonstrations run on Algorand TestNet.
        </p>
      </div>
    </footer>
  );
}
