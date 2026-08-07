/**
 * The tool registry and its authorisation gate.
 *
 * Every tool call an agent makes passes through `invoke`. Nothing reaches a
 * handler without clearing, in order:
 *
 *   1. the kill switch
 *   2. the tool exists
 *   3. the calling role owns that capability
 *   4. tenant isolation — the call touches only the acting tenant's data
 *   5. a compliance veto on this step
 *   6. irreversible actions carry an approval token
 *   7. input validates against the tool's schema
 *
 * Order matters. The kill switch is checked first because an emergency stop
 * must halt everything regardless of how well-formed the call is. Input
 * validation is last because it is the only check that can be expensive, and
 * an unauthorised call should be refused before we spend effort parsing it.
 *
 * Every call — allowed or refused — is recorded. The audit log is the
 * evidence a judge reads to see that a blocked action was genuinely blocked.
 */

import type { AgentRole } from '@logisticdigi/core';
import { z } from 'zod';
import {
  findCapability,
  isIrreversible,
  type ToolCapability,
  type ToolEffect,
  type ToolName,
} from './capabilities.js';

export interface ToolCallContext {
  readonly runId: string;
  readonly stepId: string;
  /** The tenant on whose behalf the agent is acting. */
  readonly tenantId: string;
  readonly role: AgentRole;
  readonly now: number;
  /**
   * Proof that a human approved this step. Required for irreversible
   * effects. Absent means no approval was granted.
   */
  readonly approvalToken?: string;
}

export interface ToolDefinition<Input, Output> {
  readonly name: ToolName;
  readonly schema: z.ZodType<Input>;
  readonly handler: (input: Input, context: ToolCallContext) => Promise<Output>;
}

export type RefusalCode =
  | 'KILL_SWITCH'
  | 'UNKNOWN_TOOL'
  | 'NOT_IMPLEMENTED'
  | 'OUT_OF_SCOPE'
  | 'CROSS_TENANT'
  | 'VETOED'
  | 'APPROVAL_REQUIRED'
  | 'INVALID_INPUT';

export interface ToolRefusal {
  readonly ok: false;
  readonly code: RefusalCode;
  readonly message: string;
}

export type ToolOutcome<Output> = { readonly ok: true; readonly value: Output } | ToolRefusal;

export interface ToolAuditEntry {
  readonly seq: number;
  readonly at: number;
  readonly runId: string;
  readonly stepId: string;
  readonly tenantId: string;
  readonly role: AgentRole;
  readonly tool: string;
  readonly effect: ToolEffect | null;
  readonly allowed: boolean;
  readonly refusalCode: RefusalCode | null;
  readonly message: string | null;
}

/** State the gate consults but does not own. */
export interface GuardState {
  /** Global emergency stop. Halts every tool in every run. */
  readonly killSwitchEngaged: boolean;
  /** Step ids the compliance agent has vetoed. */
  readonly vetoedSteps: ReadonlySet<string>;
}

export const OPEN_GUARDS: GuardState = {
  killSwitchEngaged: false,
  vetoedSteps: new Set(),
};

/**
 * Input shape every tenant-scoped tool must accept.
 *
 * Declaring it here rather than trusting each handler means the isolation
 * check is structural: a tenant-scoped tool cannot be written in a way that
 * skips it.
 */
export const tenantScopedInput = z.object({ tenantId: z.string().min(1) });

export class Toolbox {
  readonly #definitions = new Map<ToolName, ToolDefinition<unknown, unknown>>();
  #audit: ToolAuditEntry[] = [];
  #guards: GuardState;

  constructor(guards: GuardState = OPEN_GUARDS) {
    this.#guards = guards;
  }

  /** Register a handler for a declared capability. */
  register<Input, Output>(definition: ToolDefinition<Input, Output>): this {
    if (!findCapability(definition.name)) {
      throw new Error(
        `"${definition.name}" is not a declared capability; add it to CAPABILITIES first ` +
          'so its scope and effect are reviewable',
      );
    }
    if (this.#definitions.has(definition.name)) {
      throw new Error(`"${definition.name}" is already registered`);
    }
    this.#definitions.set(
      definition.name,
      definition as unknown as ToolDefinition<unknown, unknown>,
    );
    return this;
  }

  setGuards(guards: GuardState): void {
    this.#guards = guards;
  }

  get guards(): GuardState {
    return this.#guards;
  }

  get audit(): readonly ToolAuditEntry[] {
    return this.#audit;
  }

  clearAudit(): void {
    this.#audit = [];
  }

  /**
   * Authorise a call without executing it.
   *
   * Exposed separately so the planner can ask "could this agent do this?"
   * when compiling a workflow, rather than discovering it at execution time
   * after a payment has already settled upstream.
   */
  authorize(tool: string, input: unknown, context: ToolCallContext): ToolRefusal | null {
    if (this.#guards.killSwitchEngaged) {
      return {
        ok: false,
        code: 'KILL_SWITCH',
        message: 'the emergency stop is engaged; no tool may run',
      };
    }

    const capability = findCapability(tool);
    if (!capability) {
      return { ok: false, code: 'UNKNOWN_TOOL', message: `"${tool}" is not a known tool` };
    }

    if (capability.role !== context.role) {
      return {
        ok: false,
        code: 'OUT_OF_SCOPE',
        message:
          `the ${context.role} agent attempted "${tool}", which belongs to the ` +
          `${capability.role} agent; delegate instead`,
      };
    }

    const crossTenant = this.#checkTenant(capability, input, context);
    if (crossTenant) return crossTenant;

    if (this.#guards.vetoedSteps.has(context.stepId)) {
      return {
        ok: false,
        code: 'VETOED',
        message:
          `step "${context.stepId}" was vetoed by the compliance agent; ` +
          'no role can override a veto',
      };
    }

    if (isIrreversible(capability.effect) && !context.approvalToken) {
      return {
        ok: false,
        code: 'APPROVAL_REQUIRED',
        message:
          `"${tool}" has an irreversible ${capability.effect} effect and requires an ` +
          'approval token; the step must pass an approval gate first',
      };
    }

    return null;
  }

  /**
   * Tenant isolation.
   *
   * A tenant-scoped tool must declare the tenant it acts on, and that tenant
   * must be the one the agent is acting for. This is what stops Company A's
   * procurement agent from reading Company B's stock levels — the single
   * most damaging thing a confused or injected agent could do in a
   * multi-tenant marketplace.
   */
  #checkTenant(
    capability: ToolCapability,
    input: unknown,
    context: ToolCallContext,
  ): ToolRefusal | null {
    if (!capability.tenantScoped) return null;

    const parsed = tenantScopedInput.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'CROSS_TENANT',
        message:
          `"${capability.name}" is tenant-scoped but the call did not declare a tenantId; ` +
          'the request is refused rather than defaulted',
      };
    }
    if (parsed.data.tenantId !== context.tenantId) {
      return {
        ok: false,
        code: 'CROSS_TENANT',
        message:
          `the ${context.role} agent for "${context.tenantId}" attempted "${capability.name}" ` +
          `against "${parsed.data.tenantId}"; cross-tenant access is refused`,
      };
    }
    return null;
  }

  async invoke<Output = unknown>(
    tool: string,
    input: unknown,
    context: ToolCallContext,
  ): Promise<ToolOutcome<Output>> {
    const capability = findCapability(tool);

    const refusal = this.authorize(tool, input, context);
    if (refusal) {
      this.#record(tool, capability?.effect ?? null, context, false, refusal);
      return refusal;
    }

    const definition = this.#definitions.get(tool as ToolName);
    if (!definition) {
      const notImplemented: ToolRefusal = {
        ok: false,
        code: 'NOT_IMPLEMENTED',
        message: `"${tool}" is declared but has no registered handler`,
      };
      this.#record(tool, capability?.effect ?? null, context, false, notImplemented);
      return notImplemented;
    }

    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) {
      // Tool arguments frequently originate from a model, so malformed input
      // is an expected outcome rather than an exception.
      const invalid: ToolRefusal = {
        ok: false,
        code: 'INVALID_INPUT',
        message: `"${tool}" received invalid input: ${describeIssues(parsed.error)}`,
      };
      this.#record(tool, capability?.effect ?? null, context, false, invalid);
      return invalid;
    }

    const value = (await definition.handler(parsed.data, context)) as Output;
    this.#record(tool, capability?.effect ?? null, context, true, null);
    return { ok: true, value };
  }

  #record(
    tool: string,
    effect: ToolEffect | null,
    context: ToolCallContext,
    allowed: boolean,
    refusal: ToolRefusal | null,
  ): void {
    this.#audit.push({
      seq: this.#audit.length + 1,
      at: context.now,
      runId: context.runId,
      stepId: context.stepId,
      tenantId: context.tenantId,
      role: context.role,
      tool,
      effect,
      allowed,
      refusalCode: refusal?.code ?? null,
      message: refusal?.message ?? null,
    });
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}
