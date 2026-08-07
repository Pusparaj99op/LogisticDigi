import { describe, expect, it } from 'vitest';
import { createBudget, parseAmount, reserve, settle } from '@logisticdigi/core';
import { World } from '@logisticdigi/eval';
import { DEFAULT_FLEET } from '@logisticdigi/sim';
import { ledgerEntriesFor } from './mirror.js';

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
