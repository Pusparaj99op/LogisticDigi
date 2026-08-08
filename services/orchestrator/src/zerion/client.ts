/**
 * Zerion Wallet API client — real read-only portfolio/transaction data for a
 * genuine EVM/Solana wallet, called by the Settlement agent alongside (not
 * instead of) the Algorand x402 payment it actually settles with.
 *
 * Honesty constraint: Zerion does not index Algorand at all (EVM chains +
 * Solana only, confirmed against developers.zerion.io), and this product's
 * entire settlement pipeline (packages/x402, eval/src/executor.ts's `pay`
 * step) is Algorand TestNet. Zerion cannot execute or verify that payment.
 * What it *can* do, and what this client does, is give the Settlement agent
 * one real, working external tool call — a live portfolio/transaction lookup
 * on a real wallet — recorded in the trace as its own event kind
 * (`zerion_check`), clearly separate from the actual settlement event. No
 * code anywhere claims Zerion settled the payment.
 *
 * Auth: HTTP Basic, API key as username, empty password (per
 * developers.zerion.io/reference/listwallettransactions).
 */

const ZERION_TIMEOUT_MS = 10_000;
const API_BASE = 'https://api.zerion.io';

export interface ZerionPortfolioSummary {
  readonly address: string;
  readonly totalValueUsd: number;
  readonly checkedAt: number;
}

export interface ZerionClient {
  getPortfolioSummary(address: string): Promise<ZerionPortfolioSummary>;
}

interface ZerionPortfolioResponse {
  readonly data?: {
    readonly attributes?: {
      readonly total?: { readonly positions?: number };
    };
  };
}

export class RealZerionClient implements ZerionClient {
  readonly #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async getPortfolioSummary(address: string): Promise<ZerionPortfolioSummary> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ZERION_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/v1/wallets/${address}/portfolio?currency=usd`, {
        headers: { Authorization: `Basic ${Buffer.from(`${this.#apiKey}:`).toString('base64')}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Zerion responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as ZerionPortfolioResponse;
      const totalValueUsd = data.data?.attributes?.total?.positions ?? 0;
      return { address, totalValueUsd, checkedAt: Date.now() };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * No-op client used when ZERION_API_KEY is absent, mirroring routedClient()'s
 * graceful-fallback ethos for the LLM providers — a missing key skips the
 * check instead of failing the settlement step.
 */
export class NullZerionClient implements ZerionClient {
  async getPortfolioSummary(): Promise<ZerionPortfolioSummary> {
    throw new Error('ZERION_API_KEY not set — Zerion check skipped');
  }
}

export function zerionClientFromEnv(): ZerionClient {
  const apiKey = process.env.ZERION_API_KEY;
  return apiKey ? new RealZerionClient(apiKey) : new NullZerionClient();
}
