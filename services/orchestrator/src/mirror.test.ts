import { describe, expect, it } from 'vitest';
import { compileWorkflow, createBudget, parseAmount, reserve, settle } from '@logisticdigi/core';
import { World } from '@logisticdigi/eval';
import { DEFAULT_FLEET, type Offer } from '@logisticdigi/sim';
import { ledgerEntriesFor, negotiationDocsFrom, shipmentDocFrom } from './mirror.js';

const usdc = (amount: string) => parseAmount('USDC', amount);

describe('ledgerEntriesFor', () => {
  it('reports a new reservation as "reserved"', () => {
    const before = createBudget({ asset: 'USDC', workflowCap: usdc('500') });
    const after = reserve(
      before,
      { stepId: 'pay_supplier', idempotencyKey: 'k1', amount: usdc('200'), counterpartyId: 'sup_northwind' },
      new Date(0),
    );
    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });

    const entries = ledgerEntriesFor(before, after, {
      tenantId: 'tenant_a',
      runId: 'run_1',
      world,
      at: 1_000,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'reserved',
      amountUnits: usdc('200').units.toString(),
      counterparty: 'Northwind Supply',
      stepId: 'pay_supplier',
    });
  });

  it('reports a settlement, attaching the matching receipt', () => {
    const reserved = reserve(
      createBudget({ asset: 'USDC', workflowCap: usdc('500') }),
      { stepId: 'pay_supplier', idempotencyKey: 'k1', amount: usdc('200'), counterpartyId: 'sup_northwind' },
      new Date(0),
    );
    const settled = settle(reserved, { stepId: 'pay_supplier', amount: usdc('200') });

    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });
    world.receipts.push({
      txid: 'TX123',
      confirmedRound: 1n,
      network: 'algorand-testnet',
      assetId: 1,
      from: 'A',
      to: 'B',
      amount: usdc('200'),
      nonce: 'n1',
      resource: 'of_sup_northwind_x:pay_supplier',
      scheme: 'exact',
      settledAt: 1_000,
      explorerUrl: 'simulated://tx/TX123',
    });

    const entries = ledgerEntriesFor(reserved, settled, {
      tenantId: 'tenant_a',
      runId: 'run_1',
      world,
      at: 2_000,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'settled',
      txid: 'TX123',
      explorerUrl: 'simulated://tx/TX123',
    });
  });

  it('produces no entries when nothing changed', () => {
    const state = createBudget({ asset: 'USDC', workflowCap: usdc('500') });
    const world = new World({ seed: 1, budgetCap: usdc('500'), now: 0, providers: DEFAULT_FLEET });
    expect(ledgerEntriesFor(state, state, { tenantId: 't', runId: 'r', world, at: 0 })).toEqual([]);
  });
});

function offerFor(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'of_car_atlas_x',
    providerId: 'car_atlas',
    providerName: 'Atlas Freight',
    kind: 'carrier',
    title: 'reefer container 40ft — Rotterdam to Mumbai',
    terms: 'reefer container 40ft, Rotterdam to Mumbai. Payment on delivery, 12 day transit.',
    price: usdc('120'),
    scheme: 'exact',
    qualityScore: 0.9,
    etaDays: 12,
    issuedAt: 0,
    expiresAt: 100_000,
    ...overrides,
  };
}

describe('shipmentDocFrom', () => {
  it('builds a shipment with real coordinates parsed from the offer route', () => {
    const shipment = shipmentDocFrom(offerFor(), {
      tenantId: 'tenant_a',
      sellerTenantId: 'car_atlas',
      runId: 'run_1',
      at: 5_000,
    });

    expect(shipment).toMatchObject({
      mode: 'ship',
      originName: 'Rotterdam',
      destinationName: 'Mumbai',
      origin: [51.92, 4.48],
      destination: [19.08, 72.88],
      etaDays: 12,
    });
  });

  it('returns null when the offer title has no recognisable route', () => {
    const shipment = shipmentDocFrom(offerFor({ title: 'a mystery shipment' }), {
      tenantId: 'tenant_a',
      sellerTenantId: 'car_atlas',
      runId: 'run_1',
      at: 0,
    });
    expect(shipment).toBeNull();
  });
});

describe('negotiationDocsFrom', () => {
  it('grounds the transcript in the real offer and agreed price', () => {
    const workflow = compileWorkflow({
      id: 'wf',
      tenantId: 'tenant_a',
      goal: 'test',
      budget: usdc('500'),
      steps: [{ id: 'negotiate_terms', kind: 'negotiate', role: 'negotiation', description: 'negotiate' }],
    });
    const step = workflow.steps.get('negotiate_terms');
    if (!step) throw new Error('missing step');

    const offer = offerFor({ kind: 'supplier', providerId: 'sup_northwind', providerName: 'Northwind Supply' });
    const { negotiation, messages } = negotiationDocsFrom(step, offer, usdc('112.80'), {
      tenantId: 'tenant_a',
      runId: 'run_1',
      at: 1_000,
    });

    expect(negotiation).toMatchObject({
      buyerTenantId: 'tenant_a',
      sellerTenantId: 'sup_northwind',
      sellerName: 'Northwind Supply',
    });
    expect(messages).toHaveLength(3);
    expect(messages[0]?.text).toContain('120.000000 USDC');
    expect(messages[1]?.text).toContain('112.800000 USDC');
    expect(messages[2]?.kind).toBe('accept');
  });
});
