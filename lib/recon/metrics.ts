/**
 * Grading. This is the only module that reads ground truth.
 *
 * The distinction that matters: **match rate** is how often the engine felt
 * finished, **precision** is how often it was right. A matcher that pairs every
 * record with its nearest neighbour reports a magnificent match rate and is
 * useless. Both numbers are computed here from the same run so they can be
 * shown side by side, and the false-positive count — the matches the engine
 * asserted that ground truth disagrees with — is reported as a first-class
 * figure rather than being folded into an accuracy percentage where it
 * disappears.
 */

import type { Dataset, Match, ReconException } from './types'
import { buildBatches } from './normalize'
import { PLANTED_CODES } from './reason-codes'

export interface LevelMetrics {
  predicted: number
  actual: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number
  recall: number
  f1: number
}

export interface ThroughputMetrics {
  records: number
  wallMs: number
  recordsPerSecond: number
  llmCalls: number
  llmInputTokens: number
  llmOutputTokens: number
  estCostUsd: number
}

export interface RunMetrics {
  l1: LevelMetrics
  l2: LevelMetrics
  overall: LevelMetrics
  resolution: {
    totalPairs: number
    autoMatched: number
    review: number
    missed: number
    falsePositives: number
    autoMatchRate: number
    reviewRate: number
  }
  tierBreakdown: Record<string, number>
  /** Per planted class: how many were planted, and how many the engine handled correctly. */
  plantedRecall: Record<string, { planted: number; handled: number }>
  exceptionsByCode: Record<string, number>
  unmatchedValuePaise: number
  varianceValuePaise: number
  throughput: ThroughputMetrics
}

const key = (a: string, b: string) => `${a}|${b}`

function levelMetrics(predicted: Set<string>, actual: Set<string>): LevelMetrics {
  let tp = 0
  for (const p of predicted) if (actual.has(p)) tp++
  const fp = predicted.size - tp
  const fn = actual.size - tp

  const precision = predicted.size === 0 ? 1 : tp / predicted.size
  const recall = actual.size === 0 ? 1 : tp / actual.size
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  return {
    predicted: predicted.size,
    actual: actual.size,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
  }
}

/**
 * Whether a planted exception was actually dealt with.
 *
 * The bar differs by class and the difference is the point. For a class that
 * should still reconcile — a mangled narration, a split payout — handling it
 * means producing the correct match. For a class that should *not* reconcile —
 * a payout that never landed, a credit from nowhere, a double capture — the
 * only correct outcome is an exception naming it. Scoring both as "did it
 * match?" would reward an engine for matching things that are not there.
 */
function wasHandled(
  recordId: string,
  code: string,
  ctx: {
    truePositiveIds: Set<string>
    exceptionByRecord: Map<string, ReconException>
    matchByRecord: Map<string, Match>
    lineToBatch: Map<string, string>
    settlementsWithCredit: Set<string>
  },
): boolean {
  switch (code) {
    case 'MISSING_CREDIT':
    case 'ORPHAN_CREDIT':
    case 'DUPLICATE_CAPTURE':
      return ctx.exceptionByRecord.get(recordId)?.code === code

    case 'FEE_DRIFT': {
      // Matched is not enough: the whole value of catching fee drift is saying
      // so. A silent correct match here is a leak that nobody was told about.
      const match = ctx.matchByRecord.get(recordId)
      return !!match && match.varianceCode === 'FEE_DRIFT'
    }

    case 'PARTIAL_REFUND':
    case 'CHARGEBACK': {
      // Planted on a reversal line, which never matches an order on its own.
      // It is handled when the payout it rode in on was resolved correctly.
      const settlementId = ctx.lineToBatch.get(recordId)
      if (!settlementId) return false
      if (ctx.truePositiveIds.has(settlementId)) return true

      // A reversal can land in a payout that itself never reached the bank.
      // There is no match to make, and reporting the payout as missing IS the
      // correct outcome for this line too. Scoring it as a miss would penalise
      // the engine for being right, and did — until this case was added.
      return (
        !ctx.settlementsWithCredit.has(settlementId) &&
        ctx.exceptionByRecord.get(settlementId)?.code === 'MISSING_CREDIT'
      )
    }

    default:
      // TIMING_GAP, ROUNDING, NARRATION_NOISE, SPLIT_PAYOUT — should still match.
      return ctx.truePositiveIds.has(recordId)
  }
}

export function gradeRun(
  dataset: Dataset,
  matches: Match[],
  exceptions: ReconException[],
  throughput: ThroughputMetrics,
): RunMetrics {
  const asserted = matches.filter((m) => m.state !== 'exception')

  const predictedL1 = new Set(
    asserted.filter((m) => m.level === 'L1').map((m) => key(m.leftId, m.rightId)),
  )
  const predictedL2 = new Set(
    asserted.filter((m) => m.level === 'L2').map((m) => key(m.leftId, m.rightId)),
  )
  const actualL1 = new Set(dataset.truth.l1Pairs.map(([a, b]) => key(a, b)))
  const actualL2 = new Set(dataset.truth.l2Pairs.map(([a, b]) => key(a, b)))

  const l1 = levelMetrics(predictedL1, actualL1)
  const l2 = levelMetrics(predictedL2, actualL2)
  const overall = levelMetrics(
    new Set([...predictedL1, ...predictedL2]),
    new Set([...actualL1, ...actualL2]),
  )

  // ── Which individual records ended up in a correct pair ───────────────────
  const truePositiveIds = new Set<string>()
  for (const m of asserted) {
    const k = key(m.leftId, m.rightId)
    if ((m.level === 'L1' ? actualL1 : actualL2).has(k)) {
      truePositiveIds.add(m.leftId)
      truePositiveIds.add(m.rightId)
    }
  }

  const matchByRecord = new Map<string, Match>()
  for (const m of asserted) {
    matchByRecord.set(m.leftId, m)
    matchByRecord.set(m.rightId, m)
  }
  const exceptionByRecord = new Map(exceptions.map((e) => [e.recordId, e]))
  const lineToBatch = new Map(dataset.settlements.map((s) => [s.lineId, s.settlementId]))

  // ── Auto-match vs review vs missed ────────────────────────────────────────
  const totalPairs = actualL1.size + actualL2.size
  let autoMatched = 0
  let review = 0
  for (const m of asserted) {
    const k = key(m.leftId, m.rightId)
    if (!(m.level === 'L1' ? actualL1 : actualL2).has(k)) continue
    if (m.state === 'matched') autoMatched++
    else review++
  }

  // ── Planted-class recall ──────────────────────────────────────────────────
  // Which payouts a bank credit genuinely exists for. A batch absent from this
  // set was never paid, so no match for it can be correct.
  const settlementsWithCredit = new Set(dataset.truth.l2Pairs.map(([settlementId]) => settlementId))

  const ctx = {
    truePositiveIds,
    exceptionByRecord,
    matchByRecord,
    lineToBatch,
    settlementsWithCredit,
  }
  const plantedRecall: Record<string, { planted: number; handled: number }> = {}
  for (const code of PLANTED_CODES) plantedRecall[code] = { planted: 0, handled: 0 }

  for (const [recordId, code] of Object.entries(dataset.truth.plantedClass)) {
    const bucket = (plantedRecall[code] ??= { planted: 0, handled: 0 })
    bucket.planted++
    if (wasHandled(recordId, code, ctx)) bucket.handled++
  }

  // ── Tallies ───────────────────────────────────────────────────────────────
  const tierBreakdown: Record<string, number> = {}
  for (const m of asserted) {
    const label = `tier${m.tier}`
    tierBreakdown[label] = (tierBreakdown[label] ?? 0) + 1
  }

  const exceptionsByCode: Record<string, number> = {}
  for (const e of exceptions) {
    exceptionsByCode[e.code] = (exceptionsByCode[e.code] ?? 0) + 1
  }

  const unmatchedValuePaise = exceptions
    .filter((e) => e.resolution === 'open')
    .reduce((sum, e) => sum + Math.abs(e.amountPaise), 0)

  const varianceValuePaise = asserted.reduce((sum, m) => sum + Math.abs(m.variancePaise), 0)

  return {
    l1,
    l2,
    overall,
    resolution: {
      totalPairs,
      autoMatched,
      review,
      missed: overall.falseNegatives,
      falsePositives: overall.falsePositives,
      autoMatchRate: totalPairs === 0 ? 0 : autoMatched / totalPairs,
      reviewRate: totalPairs === 0 ? 0 : review / totalPairs,
    },
    tierBreakdown,
    plantedRecall,
    exceptionsByCode,
    unmatchedValuePaise,
    varianceValuePaise,
    throughput,
  }
}

/** Records in the batch, the denominator for throughput. */
export function recordCount(dataset: Dataset): number {
  return dataset.orders.length + dataset.settlements.length + dataset.bankLines.length
}

/** Batches, recomputed for callers that only hold a dataset. */
export function datasetBatches(dataset: Dataset) {
  return buildBatches(dataset.settlements)
}
