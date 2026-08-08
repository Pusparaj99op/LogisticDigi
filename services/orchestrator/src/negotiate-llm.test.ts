import { describe, expect, it } from 'vitest';
import { compileWorkflow, parseAmount } from '@logisticdigi/core';
import { World } from '@logisticdigi/eval';
import { DEFAULT_FLEET, type Offer } from '@logisticdigi/sim';
import type { LlmClient, LlmMessage } from './llm/client.js';
import { negotiateWithLlm } from './negotiate-llm.js';

const usdc = (amount: string) => parseAmount('USDC', amount);

function offerFor(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'of_sup_northwind_x',
    providerId: 'sup_northwind',
    providerName: 'Northwind Supply',
    kind: 'supplier',
    title: 'chilled pallets — Rotterdam to Mumbai',
    terms: 'chilled pallets, Rotterdam to Mumbai. Payment on delivery, 12 day transit.',
    price: usdc('120'),
    scheme: 'exact',
    qualityScore: 0.9,
    etaDays: 12,
    issuedAt: 0,
    expiresAt: 100_000,
    ...overrides,
  };
}

function negotiateStep() {
  const workflow = compileWorkflow({
    id: 'wf',
    tenantId: 'tenant_a',
    goal: 'test',
    budget: usdc('500'),
    steps: [{ id: 'negotiate_terms', kind: 'negotiate', role: 'negotiation', description: 'negotiate' }],
  });
  const step = workflow.steps.get('negotiate_terms');
  if (!step) throw new Error('missing step');
  return step;
}

/** Replays a fixed queue of replies, one per `complete()` call, in order. */
class ScriptedClient implements LlmClient {
  #queue: string[];
  readonly calls: (readonly LlmMessage[])[] = [];

  constructor(replies: readonly string[]) {
    this.#queue = [...replies];
  }

  async complete(messages: readonly LlmMessage[]): Promise<string> {
    this.calls.push(messages);
    const reply = this.#queue.shift();
    if (reply === undefined) throw new Error('ScriptedClient ran out of replies');
    return reply;
  }
}

class FailingClient implements LlmClient {
  async complete(): Promise<string> {
    throw new Error('the model is unreachable');
  }
}

describe('negotiateWithLlm', () => {
  it('runs a 4-turn negotiation and extracts the closing FINAL_PRICE', async () => {
    const step = negotiateStep();
    const offer = offerFor();
    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });
    world.agreedOffer = offer;
    world.agreedPrice = usdc('112.8'); // guardedExecutor's deterministic figure — the fallback, not used here

    const client = new ScriptedClient([
      'Northwind Supply: We can do 120 USDC for the chilled pallets.',
      'Negotiation agent: Can you do 108?',
      'Northwind Supply: I can meet you closer, how about 115.',
      'Negotiation agent: Deal.\nFINAL_PRICE: 114.5',
    ]);

    const result = await negotiateWithLlm(step, offer, world, client, {
      tenantId: 'tenant_a',
      runId: 'run_1',
      at: 1_000,
    });

    expect(result.agreedPrice).toEqual({ asset: 'USDC', units: 114_500_000n });
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m) => m.kind)).toEqual(['proposal', 'counter', 'counter', 'accept']);
    expect(result.messages[0]?.fromRole).toBe('counterparty');
    expect(result.messages[1]?.fromRole).toBe('negotiation');
    expect(result.messages[3]?.fromRole).toBe('negotiation');
    // The FINAL_PRICE line is stripped from the displayed dialogue.
    expect(result.messages[3]?.text).not.toMatch(/FINAL_PRICE/);
    expect(result.messages[3]?.text).toContain('Deal.');
    expect(result.negotiation).toMatchObject({
      buyerTenantId: 'tenant_a',
      sellerTenantId: 'sup_northwind',
      sellerName: 'Northwind Supply',
    });
    // Real permission/restriction text reaches the model, not a placeholder.
    expect(client.calls[1]?.[0]?.content).toContain('Cannot agree above target price');
  });

  it('synthesises a confirmation line when the model outputs only FINAL_PRICE with no dialogue', async () => {
    // Common small-model behaviour: it decides the price but writes nothing
    // else on the closing turn. That is a real price, not a leak — it
    // should not fall back.
    const step = negotiateStep();
    const offer = offerFor();
    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });
    world.agreedOffer = offer;
    world.agreedPrice = usdc('112.8');

    const client = new ScriptedClient([
      'opening offer',
      'counter offer',
      'seller response',
      'FINAL_PRICE: 116',
    ]);

    const result = await negotiateWithLlm(step, offer, world, client, {
      tenantId: 'tenant_a',
      runId: 'run_1',
      at: 1_000,
    });

    expect(result.agreedPrice).toEqual(usdc('116'));
    expect(result.messages).toHaveLength(4);
    expect(result.messages[3]?.text).toContain('116.000000 USDC');
  });

  it('falls back to the deterministic concession when the model is unreachable', async () => {
    const step = negotiateStep();
    const offer = offerFor();
    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });
    world.agreedOffer = offer;
    world.agreedPrice = usdc('112.8');

    const result = await negotiateWithLlm(step, offer, world, new FailingClient(), {
      tenantId: 'tenant_a',
      runId: 'run_1',
      at: 1_000,
    });

    expect(result.agreedPrice).toEqual(usdc('112.8'));
    expect(result.messages).toHaveLength(3);
    expect(result.messages[2]?.text).toContain('accepts');
  });

  it('falls back when the closing turn has no parseable FINAL_PRICE', async () => {
    const step = negotiateStep();
    const offer = offerFor();
    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });
    world.agreedOffer = offer;
    world.agreedPrice = usdc('112.8');

    const client = new ScriptedClient([
      'opening offer',
      'counter offer',
      'seller response',
      'Sounds good, let us finalise the paperwork.', // no FINAL_PRICE line
    ]);

    const result = await negotiateWithLlm(step, offer, world, client, {
      tenantId: 'tenant_a',
      runId: 'run_1',
      at: 1_000,
    });

    expect(result.agreedPrice).toEqual(usdc('112.8'));
    expect(result.messages).toHaveLength(3);
  });

  it('falls back to the offer price when world.agreedPrice was never set', async () => {
    const step = negotiateStep();
    const offer = offerFor();
    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });
    world.agreedOffer = offer;
    // world.agreedPrice deliberately left null.

    const result = await negotiateWithLlm(step, offer, world, new FailingClient(), {
      tenantId: 'tenant_a',
      runId: 'run_1',
      at: 1_000,
    });

    expect(result.agreedPrice).toEqual(offer.price);
  });
});
