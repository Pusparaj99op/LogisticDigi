'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-context';
import { firebaseConfigured } from '@/lib/firebase';
import { Button, Eyebrow } from '@/components/primitives';

export default function SignInPage() {
  const session = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.user) router.replace('/operations');
  }, [session.user, router]);

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      // Say what went wrong and what to do, in the interface's voice.
      const code = (cause as { code?: string }).code ?? '';
      setError(
        code.includes('invalid-credential') || code.includes('wrong-password')
          ? 'That email and password do not match an account. Check both, or create an account.'
          : code.includes('email-already-in-use')
            ? 'An account already exists for that email. Sign in instead.'
            : code.includes('weak-password')
              ? 'Passwords need at least six characters.'
              : code.includes('popup-closed')
                ? 'The Google window closed before sign-in finished. Try again.'
                : (cause as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.35fr_1fr]">
      {/*
        The left panel states what the product does in the operator's terms:
        supervision of machines that spend money. It is the thesis of the app,
        not a marketing hero.
      */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-[var(--color-seam)] p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, var(--color-hazard) 0 2px, transparent 2px 22px)',
          }}
        />
        <Eyebrow>LogisticDigi</Eyebrow>
        <div className="relative max-w-xl">
          <h1 className="text-[clamp(2.6rem,5vw,4.2rem)] text-[var(--color-chalk)]">
            Your agents
            <br />
            negotiate.
            <br />
            <span className="text-[var(--color-hazard)]">You decide.</span>
          </h1>
          <p className="mt-6 max-w-md text-[var(--color-chalk-soft)]">
            Specialist agents find surplus stock, bargain with other companies, and settle on
            Algorand. Every decision they make, and every action they were stopped from taking,
            is on the record.
          </p>
        </div>
        <div className="relative flex gap-8">
          {[
            ['Spend caps', 'enforced before a payment leaves'],
            ['Approval gates', 'a person signs off above threshold'],
            ['Full trace', 'replayable, and not editable by us'],
          ].map(([term, detail]) => (
            <div key={term} className="max-w-[11rem]">
              <p className="text-sm text-[var(--color-chalk)]">{term}</p>
              <p className="mt-1 text-xs text-[var(--color-chalk-faint)]">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/*
        The form sits on `steel` rather than the void, so it reads as a panel
        the operator acts in rather than a form floating in empty space.
      */}
      <section className="flex items-center justify-center bg-[var(--color-steel)] p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl text-[var(--color-chalk)]">
            {registering ? 'Create an account' : 'Sign in'}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-chalk-soft)]">
            {registering
              ? 'You will join a workspace once an administrator adds you.'
              : 'Use your Google account, or an email and password.'}
          </p>

          {!firebaseConfigured ? (
            <p className="mt-6 border border-[var(--color-refused)] p-3 text-sm text-[var(--color-refused)]">
              Firebase is not configured. Copy <code>.env.example</code> to{' '}
              <code>apps/web/.env.local</code> and fill in the NEXT_PUBLIC_FIREBASE_ values.
            </p>
          ) : (
            <>
              <div className="mt-8">
                <Button
                  onClick={() => attempt(session.signInWithGoogle)}
                  disabled={busy}
                >
                  Continue with Google
                </Button>
              </div>

              <div className="my-6 flex items-center gap-4">
                <span className="h-px flex-1 bg-[var(--color-seam)]" />
                <span className="eyebrow">or</span>
                <span className="h-px flex-1 bg-[var(--color-seam)]" />
              </div>

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void attempt(() =>
                    registering
                      ? session.registerWithPassword(email, password)
                      : session.signInWithPassword(email, password),
                  );
                }}
              >
                <label className="block">
                  <span className="eyebrow">Email</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1 w-full rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-void)] px-3 py-2 text-sm text-[var(--color-chalk)] outline-none focus:border-[var(--color-hazard)]"
                  />
                </label>
                <label className="block">
                  <span className="eyebrow">Password</span>
                  <input
                    type="password"
                    required
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-1 w-full rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-void)] px-3 py-2 text-sm text-[var(--color-chalk)] outline-none focus:border-[var(--color-hazard)]"
                  />
                </label>

                {error ? (
                  <p className="border-l-2 border-[var(--color-refused)] pl-3 text-sm text-[var(--color-refused)]">
                    {error}
                  </p>
                ) : null}

                <Button type="submit" variant="quiet" disabled={busy}>
                  {registering ? 'Create account' : 'Sign in'}
                </Button>
              </form>

              <button
                type="button"
                className="mt-6 text-sm text-[var(--color-chalk-faint)] underline underline-offset-4 hover:text-[var(--color-chalk)]"
                onClick={() => {
                  setRegistering(!registering);
                  setError(null);
                }}
              >
                {registering ? 'I already have an account' : 'Create an account instead'}
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
