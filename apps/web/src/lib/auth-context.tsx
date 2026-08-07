'use client';

/**
 * Session state.
 *
 * Carries the tenant and role from Firebase Auth custom claims. Claims are
 * chosen over a Firestore lookup because they are signed by Auth and cannot be
 * edited by the client — the same reason the security rules read them.
 */

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { firebaseAuth, firebaseConfigured } from './firebase';

export interface Session {
  readonly user: User | null;
  readonly tenantId: string | null;
  readonly role: 'owner' | 'admin' | 'member' | null;
  readonly platformOwner: boolean;
  readonly loading: boolean;
}

interface SessionContextValue extends Session {
  signInWithGoogle(): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  registerWithPassword(email: string, password: string): Promise<void>;
  leave(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const EMPTY: Session = {
  user: null,
  tenantId: null,
  role: null,
  platformOwner: false,
  loading: true,
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(EMPTY);

  useEffect(() => {
    if (!firebaseConfigured) {
      setSession({ ...EMPTY, loading: false });
      return;
    }

    // onIdTokenChanged rather than onAuthStateChanged: claims change when a
    // user switches tenant, and only the token listener sees that.
    return onIdTokenChanged(firebaseAuth(), async (user) => {
      if (!user) {
        setSession({ ...EMPTY, loading: false });
        return;
      }
      const token = await user.getIdTokenResult();
      setSession({
        user,
        tenantId: (token.claims.tenantId as string | undefined) ?? null,
        role: (token.claims.role as Session['role']) ?? 'member',
        platformOwner: token.claims.platformOwner === true,
        loading: false,
      });
    });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...session,
      async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(firebaseAuth(), provider);
      },
      async signInWithPassword(email, password) {
        await signInWithEmailAndPassword(firebaseAuth(), email, password);
      },
      async registerWithPassword(email, password) {
        await createUserWithEmailAndPassword(firebaseAuth(), email, password);
      },
      async leave() {
        await signOut(firebaseAuth());
      },
    }),
    [session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside a SessionProvider');
  }
  return context;
}
