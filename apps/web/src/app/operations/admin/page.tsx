'use client';

import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Button, Empty, Eyebrow, FloorPanel, HazardBar, Marker } from '@/components/primitives';
import { firebaseConfigured, firestore } from '@/lib/firebase';
import { useSession } from '@/lib/auth-context';

/**
 * Platform controls.
 *
 * Backed by a single `config/flags` document that every runtime reads live, so
 * a change here reaches the tick runners, the web app, and the mobile app at
 * once. The security rules let any signed-in user *read* it — the kill switch
 * must reach every client — but only the platform owner may write.
 */

interface Flags {
  killSwitchEngaged: boolean;
  counterpartyMode: 'real' | 'simulator' | 'both';
  runtimeMode: 'vercel' | 'local-worker' | 'hybrid';
  llmRoute: 'cloud' | 'local' | 'hybrid';
}

const DEFAULTS: Flags = {
  killSwitchEngaged: false,
  counterpartyMode: 'both',
  runtimeMode: 'hybrid',
  llmRoute: 'hybrid',
};

const CHOICES: Record<Exclude<keyof Flags, 'killSwitchEngaged'>, {
  title: string;
  explain: string;
  options: readonly { value: string; label: string; detail: string }[];
}> = {
  counterpartyMode: {
    title: 'Who agents trade with',
    explain: 'Choose whether agents deal with real workspaces, the simulated fleet, or both.',
    options: [
      { value: 'real', label: 'Real workspaces', detail: 'Only other tenants on the platform' },
      { value: 'simulator', label: 'Simulated fleet', detail: 'Deterministic providers, seeded' },
      { value: 'both', label: 'Both', detail: 'Real tenants plus the simulated fleet' },
    ],
  },
  runtimeMode: {
    title: 'Where workflows run',
    explain:
      'All sources can be on at once. Step leasing means two runners cannot execute the same step.',
    options: [
      { value: 'vercel', label: 'Cloud only', detail: 'Browser and scheduled ticks' },
      { value: 'local-worker', label: 'Local worker', detail: 'Your machine drives the steps' },
      { value: 'hybrid', label: 'Both', detail: 'Cloud with the local worker helping' },
    ],
  },
  llmRoute: {
    title: 'Which model agents think with',
    explain: 'Cloud is primary. Local runs on your GPU and takes over if the cloud is unavailable.',
    options: [
      { value: 'cloud', label: 'Cloud', detail: 'Hosted model' },
      { value: 'local', label: 'Local', detail: 'Ollama on this machine' },
      { value: 'hybrid', label: 'Cloud, local fallback', detail: 'Falls back automatically' },
    ],
  },
};

export default function AdminPage() {
  const session = useSession();
  const [flags, setFlags] = useState<Flags>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) {
      setReady(true);
      return;
    }
    return onSnapshot(
      doc(firestore(), 'config', 'flags'),
      (snapshot) => {
        setFlags({ ...DEFAULTS, ...(snapshot.data() as Partial<Flags> | undefined) });
        setReady(true);
      },
      (cause) => {
        setError(cause.message);
        setReady(true);
      },
    );
  }, []);

  async function save(next: Partial<Flags>) {
    setError(null);
    const previous = flags;
    setFlags({ ...flags, ...next });
    try {
      await setDoc(doc(firestore(), 'config', 'flags'), next, { merge: true });
    } catch (cause) {
      setFlags(previous);
      setError(`That change did not save: ${(cause as Error).message}`);
    }
  }

  if (!session.platformOwner) {
    return (
      <Empty>
        These controls belong to the platform owner. Ask them if you need a setting changed.
      </Empty>
    );
  }

  if (!ready) return <Empty>Loading the current settings.</Empty>;

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Controls</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">Platform settings</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-chalk-soft)]">
          Every runtime reads these live. A change here takes effect on the next step, everywhere.
        </p>
      </div>

      {error ? (
        <p className="border-l-2 border-[var(--color-refused)] pl-3 text-sm text-[var(--color-refused)]">
          {error}
        </p>
      ) : null}

      {/*
        The emergency stop is the one place the hazard marking belongs on this
        screen: it is the boundary where a person overrides every agent at once.
      */}
      <section>
        <HazardBar label="Emergency stop — halts every agent, in every workspace" />
        <div className="mt-4 flex items-center justify-between rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)] p-5">
          <div>
            <p className="text-sm text-[var(--color-chalk)]">
              {flags.killSwitchEngaged
                ? 'All agents are stopped.'
                : 'Agents are running normally.'}
            </p>
            <p className="mt-1 text-xs text-[var(--color-chalk-faint)]">
              Stopping refuses every tool call immediately, including reads. Work in progress keeps
              its place and resumes where it left off.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Marker tone={flags.killSwitchEngaged ? 'refused' : 'clear'}>
              {flags.killSwitchEngaged ? 'stopped' : 'running'}
            </Marker>
            <Button
              variant={flags.killSwitchEngaged ? 'primary' : 'danger'}
              onClick={() => void save({ killSwitchEngaged: !flags.killSwitchEngaged })}
            >
              {flags.killSwitchEngaged ? 'Resume all agents' : 'Stop all agents'}
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {(Object.keys(CHOICES) as (keyof typeof CHOICES)[]).map((key) => {
          const group = CHOICES[key];
          return (
            <FloorPanel key={key} title={group.title}>
              <p className="px-4 pt-4 text-xs text-[var(--color-chalk-faint)]">{group.explain}</p>
              <ul className="p-4">
                {group.options.map((option) => {
                  const selected = flags[key] === option.value;
                  return (
                    <li key={option.value}>
                      <button
                        type="button"
                        onClick={() => void save({ [key]: option.value } as Partial<Flags>)}
                        aria-pressed={selected}
                        className={`mb-2 w-full rounded-[2px] border px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'border-[var(--color-hazard)] bg-[var(--color-hazard-wash)]'
                            : 'border-[var(--color-seam)] hover:border-[var(--color-chalk-faint)]'
                        }`}
                      >
                        <span
                          className={`block text-sm ${
                            selected ? 'text-[var(--color-hazard)]' : 'text-[var(--color-chalk)]'
                          }`}
                        >
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--color-chalk-faint)]">
                          {option.detail}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </FloorPanel>
          );
        })}
      </div>
    </div>
  );
}
