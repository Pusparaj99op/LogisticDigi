/**
 * LLM client layer: Gemini (cloud) and Ollama (local), behind one interface.
 *
 * Plain `fetch` against each provider's REST API rather than an SDK — this
 * repo has no Claude API available this phase, and a bespoke SDK per
 * provider is one more dependency to version-pin for two HTTP calls. Every
 * request carries a hard timeout, because a hung negotiation step would
 * otherwise wedge a run's step lease for no reason.
 */

/** Cloud has no cold start; a hung call is almost certainly a dead request. */
const CLOUD_TIMEOUT_MS = 15_000;
/**
 * Local Ollama's *first* call after the model is idle can take the better
 * part of a minute — loading a several-hundred-MB model into RAM from disk —
 * even though every call after that lands in well under a second (measured:
 * ~65s cold, ~0.4s warm, for qwen2.5:0.5b on this machine). A short timeout
 * here would make the very first negotiation of a session fall back to the
 * deterministic concession even though the model was genuinely on its way to
 * answering, not stuck.
 */
const LOCAL_TIMEOUT_MS = 75_000;

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmClient {
  complete(messages: readonly LlmMessage[]): Promise<string>;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
}
interface GeminiResponse {
  readonly candidates?: readonly GeminiCandidate[];
}

export class GeminiClient implements LlmClient {
  readonly #apiKey: string;
  readonly #model: string;

  constructor(apiKey: string, model: string) {
    this.#apiKey = apiKey;
    this.#model = model;
  }

  async complete(messages: readonly LlmMessage[]): Promise<string> {
    // Gemini has no "system" role in its chat turns — system content is a
    // separate top-level field, so every system message is folded into it.
    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    return withTimeout(CLOUD_TIMEOUT_MS, async (signal) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.#model}:generateContent?key=${this.#apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
            generationConfig: { maxOutputTokens: 120, temperature: 0.85 },
          }),
          signal,
        },
      );
      if (!res.ok) {
        throw new Error(`Gemini responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text.trim()) throw new Error('Gemini returned no text (likely blocked by a safety filter)');
      return text;
    });
  }
}

interface OllamaChatResponse {
  readonly message?: { readonly content?: string };
}

export class OllamaClient implements LlmClient {
  readonly #baseUrl: string;
  readonly #model: string;

  constructor(baseUrl: string, model: string) {
    this.#baseUrl = baseUrl;
    this.#model = model;
  }

  async complete(messages: readonly LlmMessage[]): Promise<string> {
    return withTimeout(LOCAL_TIMEOUT_MS, async (signal) => {
      const res = await fetch(`${this.#baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.#model,
          messages,
          stream: false,
          options: { num_predict: 90, temperature: 0.85 },
        }),
        signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as OllamaChatResponse;
      const text = data.message?.content ?? '';
      if (!text.trim()) throw new Error('Ollama returned no text');
      return text;
    });
  }
}

/**
 * Tries `primary`, falls back to `secondary` on any failure (missing key,
 * network error, timeout, empty response). Used for `LLM_ROUTE=hybrid`.
 */
export class FallbackClient implements LlmClient {
  readonly #primary: LlmClient;
  readonly #secondary: LlmClient;

  constructor(primary: LlmClient, secondary: LlmClient) {
    this.#primary = primary;
    this.#secondary = secondary;
  }

  async complete(messages: readonly LlmMessage[]): Promise<string> {
    try {
      return await this.#primary.complete(messages);
    } catch (cause) {
      console.warn(`[llm] primary provider failed, falling back: ${(cause as Error).message}`);
      return this.#secondary.complete(messages);
    }
  }
}

export type LlmRoute = 'cloud' | 'local' | 'hybrid';

/**
 * Builds the client the rest of the orchestrator asks for by name, reading
 * the same env vars .env.example documents (GEMINI_API_KEY, GEMINI_MODEL,
 * OLLAMA_BASE_URL, LLM_LOCAL_MODEL, LLM_ROUTE). `cloud` and `local` are
 * strict — no fallback between them, so a demo explicitly pinned to one
 * provider fails loudly instead of silently using the other.
 */
export function routedClient(route: LlmRoute = (process.env.LLM_ROUTE as LlmRoute) || 'hybrid'): LlmClient {
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const ollamaModel = process.env.LLM_LOCAL_MODEL || 'qwen2.5:0.5b';

  const ollama = new OllamaClient(ollamaUrl, ollamaModel);

  if (route === 'local') return ollama;

  if (route === 'cloud') {
    if (!geminiKey) throw new Error('LLM_ROUTE=cloud but GEMINI_API_KEY is not set');
    return new GeminiClient(geminiKey, geminiModel);
  }

  // hybrid
  if (!geminiKey) return ollama;
  return new FallbackClient(new GeminiClient(geminiKey, geminiModel), ollama);
}
