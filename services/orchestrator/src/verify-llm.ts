#!/usr/bin/env -S node --import tsx
/**
 * Self-check for the LLM providers, mirroring verify.ts's pattern for
 * Firebase credentials. Tests Gemini and Ollama *separately* (not through
 * routedClient's hybrid fallback) so the report says exactly which one
 * actually answered, rather than "a provider answered."
 */

import { GeminiClient, OllamaClient } from './llm/client.js';

const PROMPT = [
  { role: 'system' as const, content: 'Reply with exactly one short sentence, in character.' },
  { role: 'user' as const, content: 'Say hello as a freight broker opening a negotiation.' },
];

async function main(): Promise<void> {
  const working: string[] = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const reply = await new GeminiClient(geminiKey, process.env.GEMINI_MODEL || 'gemini-2.5-flash').complete(
        PROMPT,
      );
      console.log('[verify-llm] Gemini OK:', reply.trim());
      working.push('gemini');
    } catch (cause) {
      console.log('[verify-llm] Gemini FAILED:', (cause as Error).message);
    }
  } else {
    console.log('[verify-llm] GEMINI_API_KEY not set — skipping the cloud check.');
  }

  try {
    const reply = await new OllamaClient(
      process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      process.env.LLM_LOCAL_MODEL || 'qwen2.5:0.5b',
    ).complete(PROMPT);
    console.log('[verify-llm] Ollama OK:', reply.trim());
    working.push('ollama');
  } catch (cause) {
    console.log(
      '[verify-llm] Ollama FAILED:',
      (cause as Error).message,
      '— is `ollama serve` running and has the model been pulled?',
    );
  }

  if (working.length === 0) {
    console.error(
      '\n[verify-llm] Neither provider answered. The negotiate step will still work — it falls back to the ' +
        'deterministic concession — but the dialogue will be templated, not generated.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`\n[verify-llm] Working provider(s): ${working.join(', ')}.`);
}

void main();
