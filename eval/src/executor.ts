/**
 * Step executors: the guarded orchestrator, and the baseline it must beat.
 *
 * Both run the identical workflow against the identical seeded fleet. The
 * only difference is whether the guards are consulted:
 *
 *   guarded — checks quote expiry, screens untrusted text, enforces budget
 *             reserve/settle, verifies fulfilment, refuses a price raised
 *             after approval, and pauses at approval gates.
 *   naive   — accepts what providers say. This is the "single-agent
 *             baseline" the handbook asks for: a plausible implementation
 *             that calls the same services without an orchestration layer.
 *
 * The baseline is written to be *reasonable*, not deliberately stupid. It
 * fails for the reasons a competent implementation without a policy layer
 * would actually fail, which is the only way the comparison means anything.
 * If the baseline were a strawman, the improvement number would be theatre.
 */

import {
  type CompiledStep,
  formatMoney,
  greaterThan,
  type Money,
  reserve,
  settle,
  refund,
  release,
  exposure,
  evaluateReservation,
} from '@logisticdigi/core';
import { hasConflictingQuality, ProviderTimeout, type Offer } from '@logisticdigi/sim';
import { buildRequirements, generateNonce } from '@logisticdigi/x402';
import { screenOffer, type World } from './world.js';

export interface StepResult {
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly output: Record<string, unknown>;
  readonly error?: string;
}

export type Executor = (step: CompiledStep, world: World) => Promise<StepResult>;

function ok(output: Record<string, unknown>): StepResult {
  return { status: 'succeeded', output };
}

function failed(error: string): StepResult {
  return { status: 'failed', output: {}, error };
}

/**
 * Discovery: search the shared catalogue.
 *
 * Shared by both executors — finding offers is not where the guards live.
 */
async function discover(step: CompiledStep, world: World): Promise<StepResult> {
  const offers = world.fleet.search('chilled cargo', { at: world.now });
  world.offersSeen.push(...offers);
  return ok({
    offerCount: offers.length,
    cheapestPrice: offers[0]?.price ?? null,
    offerIds: offers.map((offer) => offer.id),
  });
}

/** Pick a candidate offer deterministically: cheapest of the requested kind. */
function candidateFor(world: World, step: CompiledStep): Offer | undefined {
  const kind =
    step.role === 'logistics' ? 'carrier' : step.role === 'compliance' ? 'inspector' : 'supplier';
  return world.offersSeen
    .filter((offer) => offer.kind === kind)
    .sort((a, b) => Number(a.price.units - b.price.units))[0];
}

export const guardedExecutor: Executor = async (step, world) => {
  world.tick();

  switch (step.kind) {
    case 'discover':
      return discover(step, world);

    case 'quote': {
      const offer = candidateFor(world, step);
      if (!offer) return failed('no offer available for this step');

      // Untrusted text is screened before it can influence anything.
      const screening = screenOffer(offer);
      if (!screening.clean) {
        world.record(
          'injection_detected',
          step.id,
          `offer ${offer.id} from ${offer.providerId}: ${screening.detail}`,
        );
        return failed(`offer terms failed injection screening (${screening.detail})`);
      }

      try {
        const quote = world.fleet.quote(offer.id, world.now);
        if (quote.expiresAt <= world.now) {
          // A stale quote is refused rather than acted on: its price is not
          // the price the provider will honour.
          world.record('stale_quote_rejected', step.id, `quote for ${offer.id} had expired`);
          return failed('the quote had already expired when it was returned');
        }
        return ok({ offerId: offer.id, price: quote.price, qualityScore: offer.qualityScore });
      } catch (error) {
        if (error instanceof ProviderTimeout) {
          world.record('provider_timeout', step.id, error.providerId);
          return failed(`provider ${error.providerId} did not respond`);
        }
        throw error;
      }
    }

    case 'negotiate': {
      const offer = candidateFor(world, step);
      if (!offer) return failed('nothing to negotiate');
      const screening = screenOffer(offer);
      if (!screening.clean) {
        world.record('injection_detected', step.id, screening.detail);
        return failed('counterparty message failed injection screening');
      }
      // A deterministic 6% concession stands in for the bargaining loop, so
      // the eval measures the guards rather than a model's haggling.
      const agreed: Money = { asset: offer.price.asset, units: (offer.price.units * 94n) / 100n };
      world.agreedOffer = offer;
      world.agreedPrice = agreed;
      return ok({ offerId: offer.id, agreedPrice: agreed, qualityScore: offer.qualityScore });
    }

    case 'approve': {
      const amount = world.agreedPrice;
      if (!amount) return failed('nothing to approve');
      world.record('approval_requested', step.id, formatMoney(amount), amount);
      const decision = evaluateReservation(
        world.budget,
        { stepId: step.id, idempotencyKey: `${step.id}:approve`, amount },
        new Date(world.now),
      );
      if (decision.outcome === 'deny') {
        world.record('overspend_prevented', step.id, decision.reason, amount);
        return failed(`approval refused: ${decision.reason}`);
      }
      world.record('approval_granted', step.id, formatMoney(amount), amount);
      return ok({ approved: true, amount });
    }

    case 'pay': {
      const offer = world.agreedOffer;
      const approved = world.agreedPrice;
      if (!offer || !approved) return failed('no agreed deal to settle');

      const cap = step.maxSpend ?? approved;
      const amount = greaterThan(approved, cap) ? cap : approved;

      // Reserve before paying. An over-cap reservation is refused here.
      try {
        world.budget = reserve(
          world.budget,
          { stepId: step.id, idempotencyKey: `${step.id}:pay`, amount, counterpartyId: offer.providerId },
          new Date(world.now),
        );
      } catch (error) {
        world.record('overspend_prevented', step.id, (error as Error).message, amount);
        return failed(`budget refused the payment: ${(error as Error).message}`);
      }

      // The provider states its price at settlement time; it may have risen.
      const demand = world.fleet.demandSettlement(offer.id, amount);
      if (demand.raised) {
        world.record(
          'price_raise_rejected',
          step.id,
          `${offer.providerId} demanded ${formatMoney(demand.amount)} against an approved ` +
            `${formatMoney(amount)}`,
          demand.amount,
        );
        world.budget = release(world.budget, step.id);
        return failed('the provider raised its price after approval; settlement refused');
      }

      const requirements = buildRequirements({
        scheme: 'exact',
        payTo: world.payee.addr.toString(),
        maxAmountRequired: amount,
        nonce: generateNonce(),
        resource: `${offer.id}:${step.id}`,
        description: offer.title,
        now: world.now,
      });

      const result = await world.facilitator.handlePayment({
        payload: {
          x402Version: 1,
          scheme: 'exact',
          network: requirements.network,
          signedTxn: world.signPayment(requirements, amount),
          nonce: requirements.nonce,
          resource: requirements.resource,
        },
        requirements,
        now: world.now,
        currentRound: 40_000_000n,
      });

      if (!result.ok) {
        world.budget = release(world.budget, step.id);
        if (result.failure.kind === 'duplicate') {
          world.record('duplicate_payment_prevented', step.id, result.failure.reason);
        }
        return failed(`settlement failed: ${result.failure.reason}`);
      }

      world.receipts.push(result.receipt);
      world.budget = settle(world.budget, {
        stepId: step.id,
        amount: result.receipt.amount,
        at: new Date(world.now),
      });
      world.record('payment_settled', step.id, result.receipt.txid, result.receipt.amount);
      return ok({ txid: result.receipt.txid, paid: result.receipt.amount, offerId: offer.id });
    }

    case 'fulfill': {
      const offer = world.agreedOffer;
      if (!offer) return failed('no deal to fulfil');
      try {
        const fulfilment = world.fleet.fulfil(offer.id, world.now);
        return ok({
          complete: fulfilment.complete,
          artifact: fulfilment.artifact,
          defectRate: fulfilment.artifact.defectRate ?? null,
        });
      } catch (error) {
        if (error instanceof ProviderTimeout) {
          world.record('provider_timeout', step.id, error.providerId);
          return failed(`provider ${error.providerId} never delivered`);
        }
        throw error;
      }
    }

    case 'verify': {
      const offer = world.agreedOffer;
      if (!offer) return failed('nothing to verify');
      const fulfilment = world.fleet.fulfil(offer.id, world.now);

      // A rejected artifact is a *finding*, not a step error. Failing the
      // step would kill the branch and the compensation edge with it,
      // leaving the money gone and no claim raised. Succeeding with
      // `verified: false` lets the conditional refund edge fire, which is
      // what actually recovers the funds.
      if (!fulfilment.complete) {
        world.record(
          'partial_result_rejected',
          step.id,
          `${offer.providerId} delivered an incomplete artifact`,
        );
        return ok({
          verified: false,
          reason: 'the delivered artifact is missing required documentation',
        });
      }
      if (hasConflictingQuality(fulfilment.artifact)) {
        // The label says grade A; the provider's own measurements disagree.
        world.record(
          'conflicting_quality_rejected',
          step.id,
          `${offer.providerId} declared ${String(fulfilment.artifact.declaredGrade)} with a ` +
            `defect rate of ${String(fulfilment.artifact.defectRate)}`,
        );
        return ok({
          verified: false,
          reason: 'the declared grade contradicts the artifact\'s own defect rate',
          declaredGrade: fulfilment.artifact.declaredGrade,
          defectRate: fulfilment.artifact.defectRate,
        });
      }
      return ok({ verified: true, defectRate: fulfilment.artifact.defectRate });
    }

    case 'compensate': {
      const offer = world.agreedOffer;
      const target = step.compensates;
      if (!offer || !target) return failed('nothing to compensate');
      const settled = world.budget.reservations.get(target);
      if (!settled || settled.status !== 'settled') {
        return { status: 'skipped', output: { reason: 'nothing was settled to reclaim' } };
      }

      const claim = world.fleet.requestRefund(offer.id, settled.settled);
      if (claim.agreed.units === 0n) {
        world.record('refund_refused', step.id, claim.reason);
        return failed(`compensation refused: ${claim.reason}`);
      }
      world.budget = refund(world.budget, { stepId: target, amount: claim.agreed });
      world.record('refund_recovered', step.id, claim.reason, claim.agreed);
      return ok({ recovered: claim.agreed, reason: claim.reason });
    }

    case 'track':
      return ok({ tracked: true });

    default:
      return failed(`no executor for step kind "${step.kind}"`);
  }
};

/**
 * The baseline: same services, no orchestration layer.
 *
 * Written as a competent developer would write it without a policy engine —
 * it calls the right endpoints in the right order and believes the answers.
 * Every difference from `guardedExecutor` is a guard the orchestrator adds.
 */
export const naiveExecutor: Executor = async (step, world) => {
  world.tick();

  switch (step.kind) {
    case 'discover':
      return discover(step, world);

    case 'quote': {
      const offer = candidateFor(world, step);
      if (!offer) return failed('no offer available');

      // Scanned for reporting, but not acted on: there is no policy layer to
      // act with. This is how the eval counts what the baseline lets through.
      const screening = screenOffer(offer);
      if (!screening.clean) {
        world.record(
          'injection_reached_decision',
          step.id,
          `offer ${offer.id} terms influenced the decision: ${screening.detail}`,
        );
      }

      try {
        const quote = world.fleet.quote(offer.id, world.now);
        if (quote.expiresAt <= world.now) {
          world.record('stale_quote_accepted', step.id, `acted on an expired quote for ${offer.id}`);
        }
        return ok({ offerId: offer.id, price: quote.price, qualityScore: offer.qualityScore });
      } catch (error) {
        if (error instanceof ProviderTimeout) {
          world.record('provider_timeout', step.id, error.providerId);
          return failed(`provider ${error.providerId} did not respond`);
        }
        throw error;
      }
    }

    case 'negotiate': {
      const offer = candidateFor(world, step);
      if (!offer) return failed('nothing to negotiate');
      const screening = screenOffer(offer);
      if (!screening.clean) {
        world.record('injection_reached_decision', step.id, screening.detail);
      }
      const agreed: Money = { asset: offer.price.asset, units: (offer.price.units * 94n) / 100n };
      world.agreedOffer = offer;
      world.agreedPrice = agreed;
      return ok({ offerId: offer.id, agreedPrice: agreed, qualityScore: offer.qualityScore });
    }

    case 'approve':
      // No gate: the baseline has no approval concept.
      return ok({ approved: true, amount: world.agreedPrice });

    case 'pay': {
      const offer = world.agreedOffer;
      const approved = world.agreedPrice;
      if (!offer || !approved) return failed('no agreed deal to settle');

      // Pays whatever the provider asks at settlement time.
      const demand = world.fleet.demandSettlement(offer.id, approved);
      if (demand.raised) {
        world.record(
          'price_raise_absorbed',
          step.id,
          `paid ${formatMoney(demand.amount)} against an agreed ${formatMoney(approved)}`,
          demand.amount,
        );
      }

      const requirements = buildRequirements({
        scheme: 'exact',
        payTo: world.payee.addr.toString(),
        maxAmountRequired: demand.amount,
        nonce: generateNonce(),
        resource: `${offer.id}:${step.id}`,
        description: offer.title,
        now: world.now,
      });

      const result = await world.facilitator.handlePayment({
        payload: {
          x402Version: 1,
          scheme: 'exact',
          network: requirements.network,
          signedTxn: world.signPayment(requirements, demand.amount),
          nonce: requirements.nonce,
          resource: requirements.resource,
        },
        requirements,
        now: world.now,
        currentRound: 40_000_000n,
      });
      if (!result.ok) return failed(`settlement failed: ${result.failure.reason}`);

      world.receipts.push(result.receipt);
      world.record('payment_settled', step.id, result.receipt.txid, result.receipt.amount);

      // No reserve/settle accounting, so an overspend is only noticed after
      // the fact — which is to say, after the funds are gone.
      const spent = world.totalSettled();
      if (greaterThan(spent, world.budget.policy.workflowCap)) {
        world.record(
          'overspend_occurred',
          step.id,
          `total spend ${formatMoney(spent)} exceeded the ` +
            `${formatMoney(world.budget.policy.workflowCap)} cap`,
          spent,
        );
      }
      return ok({ txid: result.receipt.txid, paid: result.receipt.amount, offerId: offer.id });
    }

    case 'fulfill': {
      const offer = world.agreedOffer;
      if (!offer) return failed('no deal to fulfil');
      try {
        const fulfilment = world.fleet.fulfil(offer.id, world.now);
        return ok({ complete: fulfilment.complete, artifact: fulfilment.artifact });
      } catch (error) {
        if (error instanceof ProviderTimeout) {
          world.record('provider_timeout', step.id, error.providerId);
          return failed(`provider ${error.providerId} never delivered`);
        }
        throw error;
      }
    }

    case 'verify': {
      // Reads the provider's own grade and believes it.
      const offer = world.agreedOffer;
      if (!offer) return failed('nothing to verify');
      const fulfilment = world.fleet.fulfil(offer.id, world.now);
      if (!fulfilment.complete) {
        world.record('partial_result_accepted', step.id, 'accepted an incomplete artifact');
      }
      if (hasConflictingQuality(fulfilment.artifact)) {
        world.record(
          'conflicting_quality_accepted',
          step.id,
          `accepted grade ${String(fulfilment.artifact.declaredGrade)} on the provider's word`,
        );
      }
      return ok({ verified: true, declaredGrade: fulfilment.artifact.declaredGrade });
    }

    case 'compensate': {
      const offer = world.agreedOffer;
      if (!offer) return failed('nothing to compensate');
      const claim = world.fleet.requestRefund(offer.id, world.totalSettled());
      if (claim.agreed.units === 0n) {
        world.record('refund_refused', step.id, claim.reason);
        return failed(`compensation refused: ${claim.reason}`);
      }
      world.record('refund_recovered', step.id, claim.reason, claim.agreed);
      return ok({ recovered: claim.agreed });
    }

    case 'track':
      return ok({ tracked: true });

    default:
      return failed(`no executor for step kind "${step.kind}"`);
  }
};

/** Final budget position, for the report. */
export function closingPosition(world: World): {
  readonly settled: Money;
  readonly available: Money;
  readonly withinCap: boolean;
} {
  const view = exposure(world.budget);
  const settled = world.totalSettled();
  return {
    settled,
    available: view.available,
    withinCap: !greaterThan(settled, world.budget.policy.workflowCap),
  };
}
