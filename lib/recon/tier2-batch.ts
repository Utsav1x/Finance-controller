/**
 * Tier 2 — batch aggregation.
 *
 * The bank does not see payments, it sees payouts. One credit discharges a
 * whole day of settlement lines net of every refund and chargeback that rode
 * along with them, so nothing at this level matches one-to-one and comparing
 * individual payments to statement lines finds almost nothing.
 *
 * Two passes run here, in this order for a reason: a reference is evidence
 * about *identity*, an amount is evidence about *plausibility*, and identity
 * beats plausibility. Matching on amount first would let two batches that
 * happen to total the same figure trade places, and the reference that would
 * have caught it never gets consulted.
 */

import type { EvidenceItem, Match, ReconException, SettlementBatch } from './types'
import type { NormalizedBankLine } from './normalize'
import type { Tolerances } from './tolerances'
import { allowedDelta } from './tolerances'
import { businessDaysBetween } from '@/lib/format-date'
import { evidence } from './tier1-exact'

export interface L2Pass {
  matches: Match[]
  exceptions: ReconException[]
  consumedCredits: Set<string>
  resolvedBatches: Set<string>
}

function emptyPass(): L2Pass {
  return {
    matches: [],
    exceptions: [],
    consumedCredits: new Set(),
    resolvedBatches: new Set(),
  }
}

/** Which variance, if any, a correct match still needs reported against it. */
function varianceFor(
  legs: number,
  deltaPaise: number,
  dayGap: number,
  t: Tolerances,
): { code: string | null; state: 'matched' | 'review' } {
  if (legs > 1) return { code: 'SPLIT_PAYOUT', state: 'review' }
  if (dayGap > t.dateWindowDays) return { code: 'TIMING_GAP', state: 'review' }
  if (deltaPaise !== 0) return { code: 'ROUNDING', state: 'matched' }
  return { code: null, state: 'matched' }
}

/**
 * Pass A — the batch's own reference, found intact in a narration.
 *
 * Every leg carrying the reference is collected before anything is decided,
 * then the legs are required to *sum* to the batch. That single choice is what
 * makes split payouts fall out here rather than needing a special case three
 * tiers later: two credits that each look wrong alone are obviously right
 * together, and a reference that appears on legs which do not add up is
 * treated as unproven rather than accepted.
 */
export function matchL2ByReference(
  batches: SettlementBatch[],
  credits: NormalizedBankLine[],
  t: Tolerances,
): L2Pass {
  const pass = emptyPass()

  const byUtr = new Map<string, NormalizedBankLine[]>()
  for (const credit of credits) {
    if (!credit.facts.utr) continue
    const list = byUtr.get(credit.facts.utr) ?? []
    list.push(credit)
    byUtr.set(credit.facts.utr, list)
  }

  for (const batch of batches) {
    const legs = byUtr.get(batch.utr)
    if (!legs || legs.length === 0) continue
    if (legs.some((l) => pass.consumedCredits.has(l.lineId))) continue

    const total = legs.reduce((sum, l) => sum + l.creditPaise, 0)
    const delta = total - batch.netPaise
    if (Math.abs(delta) > allowedDelta(batch.netPaise, t)) {
      // The reference says these belong together but the money says otherwise.
      // Left unresolved on purpose — a reference is not a receipt.
      continue
    }

    const maxGap = Math.max(
      ...legs.map((l) => businessDaysBetween(batch.settledOn, l.valueDate)),
    )
    const { code, state } = varianceFor(legs.length, delta, maxGap, t)

    for (const leg of legs) {
      const gap = businessDaysBetween(batch.settledOn, leg.valueDate)
      const ev: EvidenceItem[] = [
        evidence('bank reference', batch.utr, leg.facts.utr ?? '—', true),
        evidence(
          legs.length > 1 ? 'batch net vs legs' : 'batch net vs credit',
          String(batch.netPaise),
          String(legs.length > 1 ? total : leg.creditPaise),
          Math.abs(delta) === 0,
          delta,
        ),
        evidence(
          'settled → value date',
          batch.settledOn,
          leg.valueDate,
          gap >= 0 && gap <= t.dateWindowDays,
        ),
        evidence('lines in batch', String(batch.lines.length), `${legs.length} credit leg(s)`, true),
      ]

      pass.matches.push({
        matchId: `L2-${batch.settlementId}-${leg.lineId}`,
        level: 'L2',
        leftId: batch.settlementId,
        rightId: leg.lineId,
        tier: 1,
        confidence: 1,
        state,
        evidence: ev,
        varianceCode: code,
        variancePaise: delta,
        rationale: null,
      })
      pass.consumedCredits.add(leg.lineId)
    }
    pass.resolvedBatches.add(batch.settlementId)
  }

  return pass
}

/**
 * Pass B — amount and date, for batches whose reference did not survive the
 * bank's export.
 *
 * A candidate must clear the tolerance band *and* be meaningfully better than
 * the runner-up. Without that second condition the engine picks whichever of
 * two indistinguishable credits it happened to see first and records the coin
 * flip with full confidence, which is precisely the failure the exception list
 * exists to prevent.
 */
export function matchL2ByAmount(
  batches: SettlementBatch[],
  credits: NormalizedBankLine[],
  t: Tolerances,
  alreadyResolved: Set<string>,
  alreadyConsumed: Set<string>,
): L2Pass {
  const pass = emptyPass()
  const consumed = new Set(alreadyConsumed)

  for (const batch of batches) {
    if (alreadyResolved.has(batch.settlementId)) continue

    const tolerance = allowedDelta(batch.netPaise, t)
    const scored = credits
      .filter((c) => !consumed.has(c.lineId))
      .map((c) => ({
        credit: c,
        delta: c.creditPaise - batch.netPaise,
        gap: businessDaysBetween(batch.settledOn, c.valueDate),
      }))
      .filter((c) => Math.abs(c.delta) <= tolerance && c.gap >= 0 && c.gap <= t.dateWindowDays)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.gap - b.gap)

    if (scored.length === 0) continue

    const best = scored[0]
    const runnerUp = scored[1]

    // Two credits equally close is not a match, it is a question.
    if (
      runnerUp &&
      Math.abs(Math.abs(runnerUp.delta) - Math.abs(best.delta)) <= t.roundingPaise &&
      runnerUp.gap === best.gap
    ) {
      pass.exceptions.push({
        exceptionId: `EXC-${batch.settlementId}`,
        level: 'L2',
        recordId: batch.settlementId,
        recordKind: 'settlement_batch',
        code: 'AMBIGUOUS',
        amountPaise: batch.netPaise,
        occurredOn: batch.settledOn,
        rejected: scored.slice(0, 4).map((c) => ({
          candidateId: c.credit.lineId,
          reason: 'indistinguishable from the other candidates on amount and date',
          deltaPaise: c.delta,
          dayGap: c.gap,
          score: 1 - Math.abs(c.delta) / Math.max(1, tolerance),
        })),
        rationale: `${scored.length} credits sit within ₹${(tolerance / 100).toFixed(2)} of this batch on the same day.`,
        resolution: 'open',
      })
      continue
    }

    const { code, state } = varianceFor(1, best.delta, best.gap, t)
    pass.matches.push({
      matchId: `L2-${batch.settlementId}-${best.credit.lineId}`,
      level: 'L2',
      leftId: batch.settlementId,
      rightId: best.credit.lineId,
      tier: 2,
      confidence: 0.95,
      state,
      evidence: [
        evidence('bank reference', batch.utr, best.credit.facts.utr ?? 'not found in narration', false),
        evidence(
          'batch net vs credit',
          String(batch.netPaise),
          String(best.credit.creditPaise),
          best.delta === 0,
          best.delta,
        ),
        evidence('settled → value date', batch.settledOn, best.credit.valueDate, true),
        evidence(
          'next best candidate',
          runnerUp ? `${runnerUp.credit.lineId} (Δ${runnerUp.delta})` : 'none',
          'clearly further away',
          true,
        ),
      ],
      varianceCode: code,
      variancePaise: best.delta,
      rationale: null,
    })
    consumed.add(best.credit.lineId)
    pass.consumedCredits.add(best.credit.lineId)
    pass.resolvedBatches.add(batch.settlementId)
  }

  return pass
}
