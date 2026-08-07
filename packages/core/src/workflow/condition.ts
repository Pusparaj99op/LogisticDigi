/**
 * Deterministic predicates for conditional workflow edges.
 *
 * A conditional edge decides whether a branch of the workflow runs — whether
 * to buy the extra freight quote, whether to skip verification because a
 * quality threshold was already met. That decision must be reproducible: the
 * handbook requires a judge to replay a run and see which decisions change.
 *
 * So conditions are a small serialisable AST evaluated over recorded step
 * outputs, never a model call. An LLM may *propose* a condition when the plan
 * is compiled; once compiled, evaluation is pure. Replaying a run with the
 * same outputs always takes the same branch.
 */

import { compare, type Money } from '../money.js';

/** A dotted path into the evaluation context, e.g. "steps.quote_a.output.price". */
export type ValueRef = string;

/** Values a condition can compare against. Deliberately narrow and JSON-safe. */
export type ConditionValue = string | number | boolean | null;

export type Condition =
  | { readonly op: 'always' }
  | { readonly op: 'never' }
  | { readonly op: 'exists'; readonly ref: ValueRef }
  | { readonly op: 'eq'; readonly ref: ValueRef; readonly value: ConditionValue }
  | { readonly op: 'neq'; readonly ref: ValueRef; readonly value: ConditionValue }
  | { readonly op: 'gt'; readonly ref: ValueRef; readonly value: number }
  | { readonly op: 'gte'; readonly ref: ValueRef; readonly value: number }
  | { readonly op: 'lt'; readonly ref: ValueRef; readonly value: number }
  | { readonly op: 'lte'; readonly ref: ValueRef; readonly value: number }
  | { readonly op: 'and'; readonly of: readonly Condition[] }
  | { readonly op: 'or'; readonly of: readonly Condition[] }
  | { readonly op: 'not'; readonly of: Condition };

/** Arbitrary recorded state a condition reads. Read-only during evaluation. */
export type ConditionContext = Record<string, unknown>;

export class ConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionError';
  }
}

/** One resolved reference, retained so a trace can explain the outcome. */
export interface ConditionResolution {
  readonly ref: ValueRef;
  readonly resolved: unknown;
  readonly found: boolean;
}

export interface ConditionResult {
  readonly value: boolean;
  /** Every reference touched, in evaluation order, for the audit trail. */
  readonly resolutions: readonly ConditionResolution[];
}

/**
 * Resolve a dotted path against the context.
 *
 * Returns a `found` flag rather than throwing on a miss: a missing output is
 * a normal state (the step has not run yet), and `exists` needs to test for
 * it. Genuine authoring errors are caught by the graph compiler instead,
 * which checks every ref against the steps that can precede it.
 */
export function resolveRef(context: ConditionContext, ref: ValueRef): ConditionResolution {
  if (ref === '') {
    throw new ConditionError('reference path must not be empty');
  }
  const segments = ref.split('.');
  let current: unknown = context;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return { ref, resolved: undefined, found: false };
    }
    if (typeof current !== 'object') {
      return { ref, resolved: undefined, found: false };
    }
    // Reject prototype-chain traversal: conditions may be derived from
    // untrusted counterparty text, and __proto__ lookups must not escape
    // the recorded context.
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      throw new ConditionError(`reference "${ref}" traverses a forbidden property "${segment}"`);
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { ref, resolved: undefined, found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  // `null` counts as absent: a recorded-but-empty output has no value to
  // compare, and `exists` must be false so a guarded branch is skipped
  // rather than compared against nothing.
  return { ref, resolved: current, found: current !== undefined && current !== null };
}

/** Type guard for the Money shape, which compares by minor units, not by ===. */
function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    'asset' in value &&
    'units' in value &&
    typeof (value as { units: unknown }).units === 'bigint'
  );
}

/**
 * Coerce a resolved value to a number for ordered comparison.
 *
 * Money is compared in its own minor units so that a threshold of `50` in a
 * condition means 50 whole USDC, matching how a human wrote the policy.
 */
function toComparableNumber(resolution: ConditionResolution, op: string): number {
  const { resolved, ref } = resolution;
  if (typeof resolved === 'number') {
    if (!Number.isFinite(resolved)) {
      throw new ConditionError(`"${ref}" is ${resolved}, which cannot be compared by "${op}"`);
    }
    return resolved;
  }
  if (typeof resolved === 'bigint') {
    return Number(resolved);
  }
  throw new ConditionError(
    `"${ref}" resolved to ${typeof resolved}, which "${op}" cannot order; ` +
      'ordered comparison requires a number',
  );
}

function compareOrdered(
  resolution: ConditionResolution,
  threshold: number,
  op: 'gt' | 'gte' | 'lt' | 'lte',
): boolean {
  let ordering: number;
  if (isMoney(resolution.resolved)) {
    const money = resolution.resolved;
    // Compare in minor units on both sides to stay in integer space.
    const scaled = BigInt(Math.round(threshold * 1_000_000));
    ordering = compare(money, { asset: money.asset, units: scaled });
  } else {
    const left = toComparableNumber(resolution, op);
    ordering = left < threshold ? -1 : left > threshold ? 1 : 0;
  }
  switch (op) {
    case 'gt':
      return ordering === 1;
    case 'gte':
      return ordering >= 0;
    case 'lt':
      return ordering === -1;
    case 'lte':
      return ordering <= 0;
  }
}

function equalsValue(resolution: ConditionResolution, value: ConditionValue): boolean {
  const { resolved } = resolution;
  if (isMoney(resolved)) {
    if (typeof value !== 'number') return false;
    return compare(resolved, {
      asset: resolved.asset,
      units: BigInt(Math.round(value * 1_000_000)),
    }) === 0;
  }
  if (typeof resolved === 'bigint' && typeof value === 'number') {
    return resolved === BigInt(value);
  }
  return resolved === value;
}

/**
 * Evaluate a condition, returning the outcome plus every reference it read.
 *
 * `and`/`or` short-circuit. This is not just convention: it makes the guard
 * idiom work — `and[exists(ref), gt(ref, x)]` must skip the comparison when
 * the output is absent, because an ordered comparison against a missing
 * value throws rather than silently deciding a payment branch. The recorded
 * resolutions therefore list exactly what was consulted, which is the honest
 * account for the trace.
 */
export function evaluateCondition(
  condition: Condition,
  context: ConditionContext,
): ConditionResult {
  const resolutions: ConditionResolution[] = [];

  const walk = (node: Condition): boolean => {
    switch (node.op) {
      case 'always':
        return true;
      case 'never':
        return false;
      case 'exists': {
        const resolution = resolveRef(context, node.ref);
        resolutions.push(resolution);
        return resolution.found;
      }
      case 'eq':
      case 'neq': {
        const resolution = resolveRef(context, node.ref);
        resolutions.push(resolution);
        const isEqual = equalsValue(resolution, node.value);
        return node.op === 'eq' ? isEqual : !isEqual;
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const resolution = resolveRef(context, node.ref);
        resolutions.push(resolution);
        if (!resolution.found) {
          throw new ConditionError(
            `"${node.ref}" is missing, so "${node.op}" cannot be evaluated; ` +
              'guard it with an "exists" condition',
          );
        }
        return compareOrdered(resolution, node.value, node.op);
      }
      case 'and': {
        if (node.of.length === 0) {
          throw new ConditionError('"and" requires at least one operand');
        }
        for (const operand of node.of) {
          if (!walk(operand)) return false;
        }
        return true;
      }
      case 'or': {
        if (node.of.length === 0) {
          throw new ConditionError('"or" requires at least one operand');
        }
        for (const operand of node.of) {
          if (walk(operand)) return true;
        }
        return false;
      }
      case 'not':
        return !walk(node.of);
    }
  };

  return { value: walk(condition), resolutions };
}

/** Collect every reference a condition reads, for compile-time validation. */
export function collectRefs(condition: Condition): readonly ValueRef[] {
  const refs: ValueRef[] = [];
  const walk = (node: Condition): void => {
    switch (node.op) {
      case 'always':
      case 'never':
        return;
      case 'exists':
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        refs.push(node.ref);
        return;
      case 'and':
      case 'or':
        node.of.forEach(walk);
        return;
      case 'not':
        walk(node.of);
        return;
    }
  };
  walk(condition);
  return refs;
}

/** Render a condition as readable text for the trace viewer and approval UI. */
export function describeCondition(condition: Condition): string {
  switch (condition.op) {
    case 'always':
      return 'always';
    case 'never':
      return 'never';
    case 'exists':
      return `${condition.ref} exists`;
    case 'eq':
      return `${condition.ref} == ${JSON.stringify(condition.value)}`;
    case 'neq':
      return `${condition.ref} != ${JSON.stringify(condition.value)}`;
    case 'gt':
      return `${condition.ref} > ${condition.value}`;
    case 'gte':
      return `${condition.ref} >= ${condition.value}`;
    case 'lt':
      return `${condition.ref} < ${condition.value}`;
    case 'lte':
      return `${condition.ref} <= ${condition.value}`;
    case 'and':
      return `(${condition.of.map(describeCondition).join(' and ')})`;
    case 'or':
      return `(${condition.of.map(describeCondition).join(' or ')})`;
    case 'not':
      return `not ${describeCondition(condition.of)}`;
  }
}

export const ALWAYS: Condition = { op: 'always' };
export const NEVER: Condition = { op: 'never' };
