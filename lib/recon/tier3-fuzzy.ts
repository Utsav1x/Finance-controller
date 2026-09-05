/**
 * Tier 3 — scored candidacy and sums.
 *
 * By this point the reference is unusable and no single credit sits inside the
 * tolerance band. Two things are still worth trying before spending a model
 * call, and both are cheap and explainable:
 *
 *   - **A weighted score.** A mangled reference is not a missing one. A digit
 *     run that is one transposition away from the batch's UTR is strong
 *     evidence, and combining that partial signal with amount and date recovers
 *     the whole narration-noise class deterministically.
 *
 *   - **Sums.** A payout split across two credits leaves no single line that
 *     looks right, so the search has to consider combinations. It is bounded
 *     hard: only credits smaller than the batch, only inside the date window,
 *     only the nearest few, only up to `maxSplitLegs` at a time. An unbounded
 *     subset-sum over a statement is both slow and a reliable way to find
 *     coincidences that are not relationships.
 */

import type { EvidenceItem, Match, ReconException, SettlementBatch } from './types'
import type { NormalizedBankLine } from './normalize'
import type { Tolerances } from './tolerances'
import { allowedDelta } from './tolerances'
import { referenceSupport } from './normalize'
import { businessDaysBetween } from '@/lib/format-date'
import { evidence } from './tier1-exact'
import type { L2Pass } from './tier2-batch'

export interface ScoredCandidate {
  credit: NormalizedBankLine
  deltaPaise: number
  dayGap: number
  amountScore: number
  dateScore: number
  refScore: number
  score: number
}

/** Weights sum to 1. Amount dominates; the reference is the tiebreaker that stops coincidences. */
const W_AMOUNT = 0.45
const W_DATE = 0.2
const W_REF = 0.35

export function scoreCandidate(
  batch: SettlementBatch,
  credit: NormalizedBankLine,
  t: Tolerances,
): ScoredCandidate {
  const deltaPaise = credit.creditPaise - batch.netPaise
  const dayGap = businessDaysBetween(batch.settledOn, credit.valueDate)
  const tolerance = allowedDelta(batch.netPaise, t)

  // Degrades over three times the tolerance band rather than falling off a
  // cliff at the edge of it — a near miss should score lower, not zero.
  const amountScore = 1 - Math.min(1, Math.abs(deltaPaise) / (tolerance * 3))

  const dateScore =
    dayGap < 0
      ? 0 // money cannot arrive before the payout was made
      : dayGap <= t.dateWindowDays
        ? 1 - dayGap / (t.dateWindowDays + 2)
        : Math.max(0, 0.4 - (dayGap - t.dateWindowDays) * 0.1)

  const refScore = referenceSupport(credit.facts, batch.utr)

  return {
    credit,
    deltaPaise,
    dayGap,
    amountScore,
    dateScore,
    refScore,
    score: W_AMOUNT * amountScore + W_DATE * dateScore + W_REF * refScore,
  }
}

export function rankCandidates(
  batch: SettlementBatch,
  credits: NormalizedBankLine[],
  t: Tolerances,
  limit = 5,
): ScoredCandidate[] {
  return credits
    .map((c) => scoreCandidate(batch, c, t))
    .filter((c) => c.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export interface L3Result extends L2Pass {
  /** Batches that survived tier 3 and their best candidates, for the adjudicator. */
  forAdjudication: { batch: SettlementBatch; candidates: ScoredCandidate[] }[]
}

export function matchL2Fuzzy(
  batches: SettlementBatch[],
  credits: NormalizedBankLine[],
  t: Tolerances,
  alreadyResolved: Set<string>,
  alreadyConsumed: Set<string>,
): L3Result {
  const result: L3Result = {
    matches: [],
    exceptions: [],
    consumedCredits: new Set<string>(),
    resolvedBatches: new Set<string>(),
    forAdjudication: [],
  }
  const consumed = new Set(alreadyConsumed)

  for (const batch of batches) {
    if (alreadyResolved.has(batch.settlementId)) continue

    const available = credits.filter((c) => !consumed.has(c.lineId))
    const ranked = rankCandidates(batch, available, t)
    const best = ranked[0]
    const runnerUp = ranked[1]

    // ── Single credit, scored ────────────────────────────────────────────────
    if (
      best &&
      best.score >= t.fuzzyAcceptScore &&
      (!runnerUp || best.score - runnerUp.score >= t.ambiguityMargin)
    ) {
      result.matches.push({
        matchId: `L2-${batch.settlementId}-${best.credit.lineId}`,
        level: 'L2',
        leftId: batch.settlementId,
        rightId: best.credit.lineId,
        tier: 3,
        confidence: Number(best.score.toFixed(3)),
        state: best.dayGap > t.dateWindowDays ? 'review' : 'matched',
        evidence: fuzzyEvidence(batch, best),
        varianceCode:
          best.refScore < 1 && best.refScore > 0
            ? 'NARRATION_NOISE'
            : best.dayGap > t.dateWindowDays
              ? 'TIMING_GAP'
              : best.deltaPaise !== 0
                ? 'ROUNDING'
                : null,
        variancePaise: best.deltaPaise,
        rationale: null,
      })
      consumed.add(best.credit.lineId)
      result.consumedCredits.add(best.credit.lineId)
      result.resolvedBatches.add(batch.settlementId)
      continue
    }

    // ── Sums, for payouts that arrived in pieces ─────────────────────────────
    const combo = findSplit(batch, available, t)
    if (combo) {
      const total = combo.reduce((sum, c) => sum + c.creditPaise, 0)
      const delta = total - batch.netPaise
      for (const leg of combo) {
        result.matches.push({
          matchId: `L2-${batch.settlementId}-${leg.lineId}`,
          level: 'L2',
          leftId: batch.settlementId,
          rightId: leg.lineId,
          tier: 3,
          confidence: 0.85,
          state: 'review',
          evidence: [
            evidence('batch net', String(batch.netPaise), `${combo.length} legs summing ${total}`, delta === 0, delta),
            evidence('this leg', String(leg.creditPaise), leg.valueDate, true),
            evidence(
              'other legs',
              combo
                .filter((c) => c.lineId !== leg.lineId)
                .map((c) => c.lineId)
                .join(', '),
              'summed with this one',
              true,
            ),
            evidence('bank reference', batch.utr, leg.facts.utr ?? 'not found in narration', false),
          ],
          varianceCode: 'SPLIT_PAYOUT',
          variancePaise: delta,
          rationale: null,
        })
        consumed.add(leg.lineId)
        result.consumedCredits.add(leg.lineId)
      }
      result.resolvedBatches.add(batch.settlementId)
      continue
    }

    // ── Neither — hand it up with what we found ──────────────────────────────
    result.forAdjudication.push({ batch, candidates: ranked })
  }

  return result
}

function fuzzyEvidence(batch: SettlementBatch, c: ScoredCandidate): EvidenceItem[] {
  return [
    evidence(
      'batch net vs credit',
      String(batch.netPaise),
      String(c.credit.creditPaise),
      c.deltaPaise === 0,
      c.deltaPaise,
    ),
    evidence(
      'bank reference',
      batch.utr,
      c.credit.facts.utr ?? c.credit.facts.digitRuns.join(' ') ?? '—',
      c.refScore === 1,
    ),
    evidence('settled → value date', batch.settledOn, c.credit.valueDate, c.dayGap >= 0),
    evidence(
      'score',
      `amount ${c.amountScore.toFixed(2)} · date ${c.dateScore.toFixed(2)} · ref ${c.refScore.toFixed(2)}`,
      c.score.toFixed(3),
      true,
    ),
  ]
}

/**
 * Bounded search for a set of credits that together satisfy one batch.
 *
 * The pool is capped before enumeration, not during: a statement day can carry
 * dozens of credits and the combination count grows fast enough that an
 * unbounded search would dominate the run time it is supposed to be proving.
 */
function findSplit(
  batch: SettlementBatch,
  credits: NormalizedBankLine[],
  t: Tolerances,
): NormalizedBankLine[] | null {
  if (t.maxSplitLegs < 2) return null
  const tolerance = allowedDelta(batch.netPaise, t)

  const pool = credits
    .filter((c) => {
      const gap = businessDaysBetween(batch.settledOn, c.valueDate)
      return gap >= 0 && gap <= t.dateWindowDays + 1 && c.creditPaise < batch.netPaise
    })
    .sort((a, b) => b.creditPaise - a.creditPaise)
    .slice(0, 12)

  if (pool.length < 2) return null

  let found: NormalizedBankLine[] | null = null

  /**
   * At least one leg must actually point at this batch.
   *
   * Summing to the right total is not evidence on its own — with a dozen
   * candidates and a tolerance band, some combination will always add up, and
   * the search will find it. Under degraded data this produced nine false
   * positives in a single run, every one of them a set of unrelated credits
   * that happened to total correctly.
   *
   * A real split payout is not anonymous: banks put the reference on at least
   * the first leg and drop it from the continuation. Requiring one supported
   * leg keeps every genuine split and removes the arithmetic coincidences.
   */
  const hasReferenceSupport = (legs: NormalizedBankLine[]) =>
    legs.some((leg) => referenceSupport(leg.facts, batch.utr) > 0)

  const walk = (start: number, chosen: NormalizedBankLine[], sum: number) => {
    if (found) return
    if (
      chosen.length >= 2 &&
      Math.abs(sum - batch.netPaise) <= tolerance &&
      hasReferenceSupport(chosen)
    ) {
      found = chosen.slice()
      return
    }
    if (chosen.length >= t.maxSplitLegs) return
    for (let i = start; i < pool.length; i++) {
      const next = sum + pool[i].creditPaise
      if (next - batch.netPaise > tolerance) continue // overshoot; skip, pool is sorted desc
      chosen.push(pool[i])
      walk(i + 1, chosen, next)
      chosen.pop()
      if (found) return
    }
  }
  walk(0, [], 0)

  return found
}

/** Everything the fuzzy tier could not resolve, as exceptions. Used when no adjudicator is available. */
export function toExceptions(
  pending: { batch: SettlementBatch; candidates: ScoredCandidate[] }[],
  code: string,
): ReconException[] {
  return pending.map(({ batch, candidates }) => ({
    exceptionId: `EXC-${batch.settlementId}`,
    level: 'L2' as const,
    recordId: batch.settlementId,
    recordKind: 'settlement_batch' as const,
    code: candidates.length === 0 ? 'NO_CANDIDATE' : code,
    amountPaise: batch.netPaise,
    occurredOn: batch.settledOn,
    rejected: candidates.map((c) => ({
      candidateId: c.credit.lineId,
      reason:
        c.refScore === 0
          ? 'no recognisable reference and outside the amount band'
          : `scored ${c.score.toFixed(2)}, below the ${'auto-accept'} bar`,
      deltaPaise: c.deltaPaise,
      dayGap: c.dayGap,
      score: Number(c.score.toFixed(3)),
    })),
    rationale:
      candidates.length === 0
        ? 'No bank credit came close enough on amount, date or reference to be worth considering.'
        : `Best candidate ${candidates[0].credit.lineId} scored ${candidates[0].score.toFixed(2)}.`,
    resolution: 'open' as const,
  }))
}
