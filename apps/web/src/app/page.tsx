import { redirect } from 'next/navigation';

/**
 * Placeholder root.
 *
 * The marketing landing page replaces this. Until then, send visitors to the
 * thing that exists rather than showing them a stub.
 */
export default function Home() {
  redirect('/sign-in');
}
