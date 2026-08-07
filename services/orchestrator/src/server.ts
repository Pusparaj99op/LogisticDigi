/**
 * HTTP tick endpoint, for driving the orchestrator from an external
 * scheduler (a cron job, a GitHub Action, a curl from your own machine)
 * instead of running worker.ts as a standing process.
 *
 * Deliberately not a Next.js route handler: apps/web is a static export (see
 * apps/web/next.config.ts), which cannot host dynamic server logic. This is
 * the standalone service .env.example's WORKER_SHARED_SECRET describes —
 * "the shared secret the local worker presents to the tick endpoint."
 *
 * State still lives in this process's memory between calls (see tick.ts), so
 * this only behaves like the worker loop if something calls /tick on a
 * steady interval and the process itself stays up between calls — a
 * always-on host, not a cold-starting serverless function.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FirestoreStore } from './firestore-store.js';
import { Orchestrator } from './tick.js';

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.WORKER_SHARED_SECRET;
const runnerId = process.env.RUNNER_ID ?? `service:${process.pid}`;

const orchestrator = new Orchestrator({ store: new FirestoreStore(), runnerId });

function authorised(req: IncomingMessage): boolean {
  if (!SECRET) return true; // unset only in local dev; see the startup warning below
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${SECRET}`;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    send(res, 200, { ok: true, runnerId });
    return;
  }

  if (req.method === 'POST' && req.url === '/tick') {
    if (!authorised(req)) {
      send(res, 401, { ok: false, error: 'missing or incorrect bearer token' });
      return;
    }
    orchestrator
      .tick()
      .then((summary) => send(res, 200, { ok: true, summary }))
      .catch((error: unknown) => send(res, 500, { ok: false, error: String(error) }));
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
});

if (!SECRET) {
  console.warn(
    '[orchestrator] WORKER_SHARED_SECRET is not set — /tick is unauthenticated. ' +
      'Set it before exposing this server outside your own machine.',
  );
}

server.listen(PORT, () => {
  console.log(`[orchestrator] listening on :${PORT} as "${runnerId}"`);
});
