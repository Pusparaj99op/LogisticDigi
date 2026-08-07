import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans, Inter, DM_Serif_Display, JetBrains_Mono } from 'next/font/google';
import { SessionProvider } from '@/lib/auth-context';
import { LenisProvider } from '@/app/providers/LenisProvider';
import './globals.css';

/**
 * Archivo carries the display voice: its width axis is what gives headings a
 * stencilled, container-plate quality rather than generic bold sans. Plex Sans
 * and Plex Mono handle body and figures — an industrial lineage that suits the
 * subject and steers clear of the usual Inter default.
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LogisticDigi — agent operations',
  description:
    'Supervise autonomous procurement agents: what they negotiated, what they spent, and what they were stopped from doing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} ${inter.variable} ${dmSerif.variable} ${jetbrainsMono.variable}`}>
        <LenisProvider>
          <SessionProvider>{children}</SessionProvider>
        </LenisProvider>
      </body>
    </html>
  );
}
