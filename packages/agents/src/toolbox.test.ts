import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capabilitiesFor, CAPABILITIES, findCapability, isIrreversible } from './capabilities.js';
import {
  type GuardState,
  OPEN_GUARDS,
  Toolbox,
  type ToolCallContext,
} from './toolbox.js';

const T0 = 1_700_000_000_000;

function context(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    runId: 'run_1',
    stepId: 'step_1',
    tenantId: 'tenant_a',
    role: 'procurement',
    now: T0,
    ...overrides,
  };
}

/** A toolbox wired with one tool per effect class, for exercising the gate. */
function toolbox(guards: GuardState = OPEN_GUARDS): Toolbox {
  return new Toolbox(guards)
    .register({
      name: 'catalog.search',
      schema: z.object({ query: z.string().min(1) }),
      handler: async (input) => ({ hits: [`offer for ${input.query}`] }),
    })
    .register({
      name: 'inventory.read',
      schema: z.object({ tenantId: z.string().min(1), sku: z.string() }),
      handler: async (input) => ({ sku: input.sku, onHand: 42 }),
    })
    .register({
      name: 'wallet.pay',
      schema: z.object({ tenantId: z.string().min(1), amount: z.string() }),
      handler: async (input) => ({ txid: `TX-${input.amount}` }),
    })
    .register({
      name: 'negotiation.propose',
      schema: z.object({ threadId: z.string(), price: z.string() }),
      handler: async () => ({ sent: true }),
    });
}

describe('the capability table', () => {
  it('gives the major agent no tools at all', () => {
    // The planner must delegate; it can never touch a wallet directly.
    const roles = new Set(CAPABILITIES.map((capability) => capability.role));
    expect(roles.has('inventory')).toBe(true);
    expect([...roles]).not.toContain('major');
  });

  it('assigns every money-moving tool to settlement alone', () => {
    const spenders = CAPABILITIES.filter((capability) => capability.effect === 'spend');
    expect(spenders.length).toBeGreaterThan(0);
    expect(spenders.every((capability) => capability.role === 'settlement')).toBe(true);
  });

  it('gives each capability exactly one owning role', () => {
    const names = CAPABILITIES.map((capability) => capability.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('scopes every wallet and inventory tool to a tenant', () => {
    const sensitive = CAPABILITIES.filter(
      (capability) =>
        capability.name.startsWith('wallet.') || capability.name.startsWith('inventory.'),
    );
    expect(sensitive.every((capability) => capability.tenantScoped)).toBe(true);
  });

  it('treats spend and external effects as irreversible', () => {
    expect(isIrreversible('spend')).toBe(true);
    expect(isIrreversible('external')).toBe(true);
    expect(isIrreversible('read')).toBe(false);
    expect(isIrreversible('write')).toBe(false);
  });

  it('lists a role\'s entire authority surface', () => {
    const names = capabilitiesFor('settlement').map((capability) => capability.name);
    expect(names).toEqual(['wallet.quote', 'wallet.pay', 'wallet.refund', 'wallet.getReceipt']);
  });

  it('resolves a known capability and rejects an invented one', () => {
    expect(findCapability('wallet.pay')?.effect).toBe('spend');
    expect(findCapability('wallet.drain')).toBeUndefined();
  });
});

describe('registration', () => {
  it('refuses a handler for an undeclared capability', () => {
    // Every tool must be declared in the reviewable table first.
    expect(() =>
      new Toolbox().register({
        name: 'wallet.drain' as never,
        schema: z.object({}),
        handler: async () => null,
      }),
    ).toThrow(/not a declared capability/);
  });

  it('refuses a duplicate registration', () => {
    expect(() =>
      toolbox().register({
        name: 'catalog.search',
        schema: z.object({}),
        handler: async () => null,
      }),
    ).toThrow(/already registered/);
  });
});

describe('scope enforcement', () => {
  it('allows a role to call its own tool', async () => {
    const result = await toolbox().invoke('catalog.search', { query: 'reefer' }, context());
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a tool belonging to another specialist', async () => {
    // Procurement reaching for the wallet is the escalation we most care about.
    const result = await toolbox().invoke(
      'wallet.pay',
      { tenantId: 'tenant_a', amount: '100' },
      context({ role: 'procurement', approvalToken: 'appr_1' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
  });

  it('names both the caller and the owning role in the refusal', async () => {
    const result = await toolbox().invoke(
      'wallet.pay',
      { tenantId: 'tenant_a', amount: '100' },
      context({ role: 'logistics', approvalToken: 'appr_1' }),
    );
    if (result.ok) throw new Error('expected refusal');
    expect(result.message).toContain('logistics');
    expect(result.message).toContain('settlement');
  });

  it('refuses an unknown tool name', async () => {
    const result = await toolbox().invoke('wallet.drain', {}, context({ role: 'settlement' }));
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_TOOL' });
  });

  it('refuses a declared capability with no handler', async () => {
    const result = await toolbox().invoke(
      'logistics.trackShipment',
      { tenantId: 'tenant_a' },
      context({ role: 'logistics' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'NOT_IMPLEMENTED' });
  });
});

describe('tenant isolation', () => {
  it('allows an agent to read its own tenant\'s stock', async () => {
    const result = await toolbox().invoke(
      'inventory.read',
      { tenantId: 'tenant_a', sku: 'PALLET-1' },
      context({ role: 'inventory' }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a read against another tenant', async () => {
    // Company A's agent must never see Company B's stock levels.
    const result = await toolbox().invoke(
      'inventory.read',
      { tenantId: 'tenant_b', sku: 'PALLET-1' },
      context({ role: 'inventory', tenantId: 'tenant_a' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'CROSS_TENANT' });
  });

  it('refuses rather than defaulting when tenantId is omitted', async () => {
    // Defaulting to the caller's tenant would hide a malformed call that
    // might have meant something else.
    const result = await toolbox().invoke(
      'inventory.read',
      { sku: 'PALLET-1' },
      context({ role: 'inventory' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'CROSS_TENANT' });
  });

  it('does not impose tenant scoping on the shared catalogue', async () => {
    // Discovery is cross-tenant by design; that is the marketplace.
    const result = await toolbox().invoke('catalog.search', { query: 'chilled' }, context());
    expect(result).toMatchObject({ ok: true });
  });
});

describe('approval gate on irreversible effects', () => {
  it('refuses a payment with no approval token', async () => {
    const result = await toolbox().invoke(
      'wallet.pay',
      { tenantId: 'tenant_a', amount: '100' },
      context({ role: 'settlement' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
  });

  it('allows the payment once an approval token is present', async () => {
    const result = await toolbox().invoke(
      'wallet.pay',
      { tenantId: 'tenant_a', amount: '100' },
      context({ role: 'settlement', approvalToken: 'appr_1' }),
    );
    expect(result).toMatchObject({ ok: true, value: { txid: 'TX-100' } });
  });

  it('gates outbound counterparty messages too, since they cannot be unsaid', async () => {
    const result = await toolbox().invoke(
      'negotiation.propose',
      { threadId: 't1', price: '100' },
      context({ role: 'negotiation' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
  });

  it('does not gate a read', async () => {
    const result = await toolbox().invoke(
      'inventory.read',
      { tenantId: 'tenant_a', sku: 'X' },
      context({ role: 'inventory' }),
    );
    expect(result).toMatchObject({ ok: true });
  });
});

describe('compliance veto', () => {
  const vetoed: GuardState = {
    killSwitchEngaged: false,
    vetoedSteps: new Set(['step_1']),
  };

  it('blocks a vetoed step even for the owning role with approval', async () => {
    // No role can override a veto — that is the point of it.
    const result = await toolbox(vetoed).invoke(
      'wallet.pay',
      { tenantId: 'tenant_a', amount: '100' },
      context({ role: 'settlement', approvalToken: 'appr_1' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'VETOED' });
  });

  it('leaves other steps in the same run unaffected', async () => {
    const result = await toolbox(vetoed).invoke(
      'catalog.search',
      { query: 'reefer' },
      context({ stepId: 'step_2' }),
    );
    expect(result).toMatchObject({ ok: true });
  });
});

describe('kill switch', () => {
  const stopped: GuardState = { killSwitchEngaged: true, vetoedSteps: new Set() };

  it('halts even a harmless read', async () => {
    const result = await toolbox(stopped).invoke('catalog.search', { query: 'x' }, context());
    expect(result).toMatchObject({ ok: false, code: 'KILL_SWITCH' });
  });

  it('takes precedence over every other check, including an unknown tool', async () => {
    // An emergency stop must not depend on the call being well-formed.
    const result = await toolbox(stopped).invoke('wallet.drain', {}, context());
    expect(result).toMatchObject({ ok: false, code: 'KILL_SWITCH' });
  });

  it('can be released at runtime', async () => {
    const box = toolbox(stopped);
    box.setGuards(OPEN_GUARDS);
    expect(await box.invoke('catalog.search', { query: 'x' }, context())).toMatchObject({
      ok: true,
    });
  });
});

describe('input validation', () => {
  it('refuses malformed arguments rather than throwing', async () => {
    // Tool arguments usually come from a model; malformed is expected.
    const result = await toolbox().invoke('catalog.search', { query: '' }, context());
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it('names the offending field so the agent can correct itself', async () => {
    const result = await toolbox().invoke('catalog.search', { wrong: 1 }, context());
    if (result.ok) throw new Error('expected refusal');
    expect(result.message).toContain('query');
  });

  it('runs after authorisation, so an unauthorised call is refused on scope', async () => {
    // Scope is the more important signal and must not be masked by a
    // validation error on a call that was never permitted.
    const result = await toolbox().invoke('wallet.pay', { garbage: true }, context());
    expect(result).toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
  });
});

describe('audit log', () => {
  it('records an allowed call with its effect', async () => {
    const box = toolbox();
    await box.invoke('catalog.search', { query: 'reefer' }, context());
    expect(box.audit).toHaveLength(1);
    expect(box.audit[0]).toMatchObject({
      seq: 1,
      tool: 'catalog.search',
      effect: 'read',
      allowed: true,
      refusalCode: null,
    });
  });

  it('records a refusal with its code and message', async () => {
    const box = toolbox();
    await box.invoke(
      'inventory.read',
      { tenantId: 'tenant_b', sku: 'X' },
      context({ role: 'inventory' }),
    );
    expect(box.audit[0]).toMatchObject({
      allowed: false,
      refusalCode: 'CROSS_TENANT',
    });
    expect(box.audit[0]?.message).toContain('tenant_b');
  });

  it('numbers entries so the sequence of attempts is reconstructable', async () => {
    const box = toolbox();
    await box.invoke('catalog.search', { query: 'a' }, context());
    await box.invoke('wallet.pay', { tenantId: 'tenant_a', amount: '1' }, context());
    await box.invoke('catalog.search', { query: 'b' }, context());
    expect(box.audit.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(box.audit.map((entry) => entry.allowed)).toEqual([true, false, true]);
  });

  it('carries the run and step so entries join onto the workflow trace', async () => {
    const box = toolbox();
    await box.invoke('catalog.search', { query: 'a' }, context({ stepId: 'discover_suppliers' }));
    expect(box.audit[0]).toMatchObject({ runId: 'run_1', stepId: 'discover_suppliers' });
  });
});

describe('authorize without executing', () => {
  it('reports a scope violation at plan time', () => {
    // The planner can ask "could this agent do this?" before compiling a
    // workflow, rather than finding out after upstream payments settled.
    const refusal = toolbox().authorize(
      'wallet.pay',
      { tenantId: 'tenant_a', amount: '1' },
      context({ role: 'procurement' }),
    );
    expect(refusal).toMatchObject({ code: 'OUT_OF_SCOPE' });
  });

  it('returns null when the call would be permitted', () => {
    expect(toolbox().authorize('catalog.search', { query: 'x' }, context())).toBeNull();
  });

  it('does not touch the audit log', () => {
    const box = toolbox();
    box.authorize('catalog.search', { query: 'x' }, context());
    expect(box.audit).toHaveLength(0);
  });
});
