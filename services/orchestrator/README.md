# LogisticDigi — orchestrator (Phase 7)

The live orchestrator. Everything phases 0–6 built — the workflow graph and
budget engine (`packages/core`), the guarded executor and provider fleet
(`@logisticdigi/eval`, `packages/sim`), and the x402/Algorand settlement path
(`packages/x402`) — was correct in isolation and covered by tests, but
nothing actually *ran* it against Firestore. This is that: a process that
drives demo procurement runs end to end and writes every step, approval, and
ledger movement to the collections `apps/web` and `apps/mobile` already read.

## What it does

Every tick:

1. **Resumes** any run paused at a human approval gate whose decision has
   landed in Firestore.
2. **Advances** every other active run: claims ready steps (with the same
   fencing-token leasing `packages/core/src/runtime/lease.ts` defines),
   executes them through `guardedExecutor` — the exact function
   `eval/src/executor.ts` validates against the scenario suite — and mirrors
   the result.
3. **Starts** a fresh run when there is spare capacity, picked round-robin
   from the eval suite's own `SCENARIOS`. That is deliberate: a live run's
   workflow, seed, and provider fleet come from the same specs the eval
   harness already checked the guards against. Nothing runs live that the
   eval hasn't exercised.

The one thing the eval harness never needed and this adds: a real human on
the other end of an approval gate. `eval/src/executor.ts`'s `approve` step
treats a `requires_approval` budget decision as a pass, because an automated
eval has no one to ask. Here there is one — see `step-runner.ts` — so that
decision opens a Firestore `approvals` document and genuinely pauses the run
until the operations console (web or mobile) records a decision.

## What it deliberately does not do

**State lives in process memory, not reconstructed from Firestore.** This is
the "local worker" mode `lease.ts`'s docstring already anticipates ("the
browser's SSE loop... a Vercel cron... the optional local worker"), run as
one long-lived process rather than a stateless serverless function that
rebuilds a run's `World` (signed keys, provider fleet, in-flight nonces) from
persisted documents on every cold start. That reconstruction is a real
project on its own; building it half-way — a `World` that resumes with the
wrong offer cached, or a nonce store that forgot an in-flight reservation —
would be worse than not building it. `worker.ts` (a standing process) and
`server.ts` (an HTTP endpoint something else pings on an interval, but which
still must stay up between calls) are today's two ways to run this; a
cold-start-safe stateless tick is future work.

**Custom-claim provisioning has no automatic trigger.** `firebase/firestore.rules`
gates every read on the caller's `tenantId`/`role` claims, and nothing in
this repo — in any phase — sets them on signup. Without it, a freshly
created account can sign in but will never see anything the orchestrator
writes, no matter how much it writes. `provision.ts` is the manual stand-in:
run it once per operator. A real product would do this from an
onCreate/beforeSignIn Cloud Function or an invite flow instead.

## Running it

Needs Firebase Admin credentials in the environment (`FIREBASE_SERVICE_ACCOUNT_JSON`
or `GOOGLE_APPLICATION_CREDENTIALS` — see `.env.example`). Neither was
available in the session that wrote this service, so `tick.ts`'s
orchestration logic is exercised in `tick.test.ts` and `mirror.test.ts`
against `MemoryStore` (no live Firebase needed to verify the logic), but a
real write to the `logisticdigi` project has not been done from here — say
so plainly rather than claim it.

```bash
# Confirm the credential actually works before anything else — writes and
# deletes one throwaway document.
pnpm --filter @logisticdigi/orchestrator run verify

# One-time: give your signed-up account a workspace to see.
pnpm --filter @logisticdigi/orchestrator run provision -- \
  --email you@example.com --tenant tenant_a --role owner

# Start the worker: ticks every 5s, writes to Firestore.
pnpm --filter @logisticdigi/orchestrator run worker

# Or run it as an HTTP service another scheduler pings:
WORKER_SHARED_SECRET=... pnpm --filter @logisticdigi/orchestrator run serve
curl -X POST -H "Authorization: Bearer $WORKER_SHARED_SECRET" http://localhost:8787/tick
```

Sign in to `apps/web` (or `apps/mobile`) as the provisioned operator and the
Floor, Approvals, and Ledger screens should start filling in within a few
ticks.

## Structure

- `store.ts` — the write contract: the exact document shapes `live.ts` /
  `live.dart` read.
- `memory-store.ts` — in-memory `Store`, used by tests and by anyone running
  the orchestrator without Firebase configured.
- `firestore-store.ts`, `admin.ts` — the production `Store`, over the Admin
  SDK.
- `demo.ts` — picks the next scenario and builds its `World` + compiled
  workflow.
- `step-runner.ts` — one step's execution: `guardedExecutor` for everything,
  the human-approval special case for `approve` steps.
- `mirror.ts` — pure budget-diff → ledger-entry mapping, unit tested without
  a `Store` at all.
- `tick.ts` — `driveRun` (one run, one tick — independently testable) and
  `Orchestrator` (holds every live run, starts new ones).
- `worker.ts`, `server.ts` — the two ways to run it.
- `provision.ts` — the manual tenant-claim assignment CLI described above.
