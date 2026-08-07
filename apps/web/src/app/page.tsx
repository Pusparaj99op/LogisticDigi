import type { Metadata } from 'next';
import { Landing } from '@/components/landing/landing';

export const metadata: Metadata = {
  title: 'LogisticDigi — your agents negotiate, you decide',
  description:
    'Specialist agents find surplus stock across companies, bargain over it, and settle on Algorand. They stop and ask before spending past your limit.',
};

export default function Home() {
  return <Landing />;
}
