/**
 * The capability model: which sub-agent may do what.
 *
 * The handbook grades least privilege, explicit capability scopes, and
 * approvals for irreversible actions. This module is where those are
 * declared, and it is deliberately data rather than code: a reviewer can
 * read the whole authority surface of the system in one table without
 * tracing call sites.
 *
 * The design rule throughout: the Major Agent holds the goal and the budget
 * but **owns no tools at all**. It can only delegate. Every capability that
 * touches data, a counterparty, or funds belongs to exactly one specialist.
 * A compromised planner therefore cannot reach a wallet directly — it can
 * only ask the settlement agent, which enforces its own preconditions.
 */

import type { AgentRole } from '@logisticdigi/core';

/**
 * Every tool in the system.
 *
 * Named `domain.verb` so a scope violation reads clearly in a trace:
 * "procurement attempted wallet.pay".
 */
export type ToolName =
  // Inventory — a tenant's own stock, never anyone else's.
  | 'inventory.read'
  | 'inventory.adjust'
  // Discovery — the shared catalogue of what other tenants are offering.
  | 'catalog.search'
  | 'catalog.getOffer'
  // Negotiation — messaging a counterparty.
  | 'negotiation.open'
  | 'negotiation.propose'
  | 'negotiation.accept'
  | 'negotiation.reject'
  // Compliance — verification and the veto.
  | 'compliance.scanArtifact'
  | 'compliance.verifyFulfilment'
  | 'compliance.veto'
  // Settlement — the money-moving surface.
  | 'wallet.quote'
  | 'wallet.pay'
  | 'wallet.refund'
  | 'wallet.getReceipt'
  // Logistics — carriers and shipments.
  | 'logistics.quoteRoute'
  | 'logistics.bookShipment'
  | 'logistics.trackShipment';

/** What a tool does to the world. Drives which guards apply. */
export type ToolEffect =
  /** Reads state. Reversible, cheap, safe to retry. */
  | 'read'
  /** Mutates state the tenant owns. Reversible with compensation. */
  | 'write'
  /** Communicates with a counterparty. Cannot be unsaid. */
  | 'external'
  /** Moves funds. Irreversible on-chain. */
  | 'spend';

export interface ToolCapability {
  readonly name: ToolName;
  readonly effect: ToolEffect;
  readonly description: string;
  /**
   * The single role permitted to call this tool.
   *
   * Deliberately one role, not a list. If two specialists both need a
   * capability, that is a signal the workflow should route through one of
   * them, not that the scope should widen.
   */
  readonly role: AgentRole;
  /** Whether the tool operates on data belonging to a specific tenant. */
  readonly tenantScoped: boolean;
}

export const CAPABILITIES: readonly ToolCapability[] = [
  {
    name: 'inventory.read',
    effect: 'read',
    role: 'inventory',
    tenantScoped: true,
    description: 'Read stock levels and surplus/deficit positions for the acting tenant.',
  },
  {
    name: 'inventory.adjust',
    effect: 'write',
    role: 'inventory',
    tenantScoped: true,
    description: 'Reserve or release stock against a deal for the acting tenant.',
  },
  {
    name: 'catalog.search',
    effect: 'read',
    role: 'procurement',
    tenantScoped: false,
    description: 'Search the shared catalogue of published offers across tenants.',
  },
  {
    name: 'catalog.getOffer',
    effect: 'read',
    role: 'procurement',
    tenantScoped: false,
    description: 'Fetch one published offer with its terms and expiry.',
  },
  {
    name: 'negotiation.open',
    effect: 'external',
    role: 'negotiation',
    tenantScoped: false,
    description: 'Open a negotiation thread with a counterparty agent.',
  },
  {
    name: 'negotiation.propose',
    effect: 'external',
    role: 'negotiation',
    tenantScoped: false,
    description: 'Send a price and terms proposal to the counterparty.',
  },
  {
    name: 'negotiation.accept',
    effect: 'external',
    role: 'negotiation',
    tenantScoped: false,
    description: 'Accept the counterparty\'s standing proposal, forming a deal.',
  },
  {
    name: 'negotiation.reject',
    effect: 'external',
    role: 'negotiation',
    tenantScoped: false,
    description: 'Reject the standing proposal and optionally close the thread.',
  },
  {
    name: 'compliance.scanArtifact',
    effect: 'read',
    role: 'compliance',
    tenantScoped: false,
    description: 'Scan untrusted counterparty text or artifacts for prompt injection.',
  },
  {
    name: 'compliance.verifyFulfilment',
    effect: 'read',
    role: 'compliance',
    tenantScoped: false,
    description: 'Check a delivered artifact against schema, hash, and quality terms.',
  },
  {
    name: 'compliance.veto',
    effect: 'write',
    role: 'compliance',
    tenantScoped: true,
    description: 'Block a step outright. No other role can override this.',
  },
  {
    name: 'wallet.quote',
    effect: 'read',
    role: 'settlement',
    tenantScoped: true,
    description: 'Request payment requirements for a paid resource (the 402 exchange).',
  },
  {
    name: 'wallet.pay',
    effect: 'spend',
    role: 'settlement',
    tenantScoped: true,
    description: 'Sign and settle a payment on Algorand. Irreversible.',
  },
  {
    name: 'wallet.refund',
    effect: 'spend',
    role: 'settlement',
    tenantScoped: true,
    description: 'Send a compensating payment back to a counterparty.',
  },
  {
    name: 'wallet.getReceipt',
    effect: 'read',
    role: 'settlement',
    tenantScoped: true,
    description: 'Fetch the confirmed transaction receipt for a settled payment.',
  },
  {
    name: 'logistics.quoteRoute',
    effect: 'read',
    role: 'logistics',
    tenantScoped: false,
    description: 'Price a route across truck, ship, rail, and air legs.',
  },
  {
    name: 'logistics.bookShipment',
    effect: 'external',
    role: 'logistics',
    tenantScoped: true,
    description: 'Book capacity with a carrier for an agreed route.',
  },
  {
    name: 'logistics.trackShipment',
    effect: 'read',
    role: 'logistics',
    tenantScoped: true,
    description: 'Fetch current position and ETA for a booked shipment.',
  },
];

const BY_NAME: ReadonlyMap<ToolName, ToolCapability> = new Map(
  CAPABILITIES.map((capability) => [capability.name, capability]),
);

export function findCapability(name: string): ToolCapability | undefined {
  return BY_NAME.get(name as ToolName);
}

/** Every tool a role may call. The role's entire authority surface. */
export function capabilitiesFor(role: AgentRole): readonly ToolCapability[] {
  return CAPABILITIES.filter((capability) => capability.role === role);
}

/**
 * Effects that can never be undone by a compensating action.
 *
 * `spend` settles on-chain and `external` has already been seen by a
 * counterparty. Both need an approval gate when they exceed policy, and
 * neither may run while the kill switch is engaged.
 */
export function isIrreversible(effect: ToolEffect): boolean {
  return effect === 'spend' || effect === 'external';
}
