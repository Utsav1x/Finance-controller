/**
 * The reconciliation run.
 *
 * The adjudicator is injected rather than imported. That is deliberate: the
 * engine must be runnable, testable and gradeable with no API key and no
 * network, because an accuracy claim that can only be reproduced by someone
 * holding the right credentials is not reproducible. When no adjudicator is
 * supplied the deterministic tiers still run end to end and everything they
 * could not resolve is reported — never guessed, never dropped.
 */

import type {
  Dataset,
  Match,
  ReconException,
  SettlementBatch,
} from './types'
import type { Tolerances } from './tolerances'
import { DEFAULT_TOLERANCES } from './tolerances'
import { buildBatches, partitionStatement, type NormalizedBankLine } from './normalize'
import { matchL1 } from './tier1-exact'
import { matchL2ByAmount, matchL2ByReference } from './tier2-batch'
import { matchL2Fuzzy, toExceptions, type ScoredCandidate } from './tier3-fuzzy'
import { gradeRun, recordCount, type RunMetrics, type ThroughputMetrics } from './metrics'

// ─── Adjudicator contract ────────────────────────────────────────────────────

export interface AdjudicationRequest {
  settlementId: string
  settledOn: string
  utr: string
  netPaise: number
  composition: { payments: number; refunds: number; chargebacks: number }
  candidates: {
    lineId: string
    valueDate: string
    narration: string
    creditPaise: number
    deltaPaise: number
    dayGap: number
    score: number
  }[]
}

export interface AdjudicationVerdict {
  settlementId: string
  decision: 'match' | 'no_match'
  /** Bank line ids. More than one means the model believes it was split. */
  matchedIds: string[]
  confidence: number
  reasonCode: string
  rationale: string
}

export interface AdjudicatorUsage {
  calls: number
  inputTokens: number
  outputTokens: number
  estCostUsd: number
}

export interface Adjudicator {
  readonly name: string
  adjudicate(
    requests: AdjudicationRequest[],
  ): Promise<{ verdicts: AdjudicationVerdict[]; usage: AdjudicatorUsage }>
}

// ─── Progress ────────────────────────────────────────────────────────────────

export interface ProgressEvent {
  stage: 'normalize' | 'l1' | 'l2-reference' | 'l2-amount' | 'l2-fuzzy' | 'adjudicate' | 'sweep' | 'grade' | 'done'
  label: string
  resolved: number
  total: number
  elapsedMs: number
  detail?: string
}

export interface RunOptions {
  tolerances?: Partial<Tolerances>
  adjudicator?: Adjudicator | null
  onProgress?: (event: ProgressEvent) => void
}

export interface RunResult {
  runId: string
  matches: Match[]
  exceptions: ReconException[]
  metrics: RunMetrics
  tolerances: Tolerances
  adjudicatorName: string | null
  timeline: ProgressEvent[]
}

export function newRunId(): string {
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// ─── The run ─────────────────────────────────────────────────────────────────

export async function reconcile(
  dataset: Dataset,
  options: RunOptions = {},
): Promise<RunResult> {
  const t: Tolerances = { ...DEFAULT_TOLERANCES, ...(options.tolerances ?? {}) }
  const started = performance.now()
  const timeline: ProgressEvent[] = []

  const total = recordCount(dataset)
  let resolved = 0

  const emit = (
    stage: ProgressEvent['stage'],
    label: string,
    detail?: string,
  ) => {
    const event: ProgressEvent = {
      stage,
      label,
      resolved,
      total,
      elapsedMs: Math.round(performance.now() - started),
      detail,
    }
    timeline.push(event)
    options.onProgress?.(event)
  }

  // ── Tier 0 ────────────────────────────────────────────────────────────────
  const batches = buildBatches(dataset.settlements)
  const { credits, debits } = partitionStatement(dataset.bankLines)
  emit(
    'normalize',
    'Normalized three sources',
    `${batches.length} payout batches · ${credits.length} credits · ${debits.length} debits set aside`,
  )

  const matches: Match[] = []
  const exceptions: ReconException[] = []

  // ── L1: orders ↔ gateway payment lines ────────────────────────────────────
  const l1 = matchL1(dataset.orders, dataset.settlements, t)
  matches.push(...l1.matches)
  exceptions.push(...l1.exceptions)
  resolved += l1.matches.length
  emit(
    'l1',
    'Matched orders to gateway payments',
    `${l1.matches.length} paired · ${l1.exceptions.length} unresolved`,
  )

  // ── L2 pass A: the batch reference, found intact ──────────────────────────
  const passA = matchL2ByReference(batches, credits, t)
  matches.push(...passA.matches)
  resolved += passA.matches.length
  emit(
    'l2-reference',
    'Matched payouts by bank reference',
    `${passA.resolvedBatches.size} batches settled on reference`,
  )

  // ── L2 pass B: amount and date ────────────────────────────────────────────
  const passB = matchL2ByAmount(batches, credits, t, passA.resolvedBatches, passA.consumedCredits)
  matches.push(...passB.matches)
  exceptions.push(...passB.exceptions)
  resolved += passB.matches.length
  emit(
    'l2-amount',
    'Matched payouts by amount and value date',
    `${passB.resolvedBatches.size} batches · ${passB.exceptions.length} ambiguous`,
  )

  const resolvedBatches = new Set([...passA.resolvedBatches, ...passB.resolvedBatches])
  const consumedCredits = new Set([...passA.consumedCredits, ...passB.consumedCredits])

  // ── L2 pass C: scored candidacy and sums ──────────────────────────────────
  const passC = matchL2Fuzzy(batches, credits, t, resolvedBatches, consumedCredits)
  matches.push(...passC.matches)
  exceptions.push(...passC.exceptions)
  resolved += passC.matches.length
  for (const id of passC.resolvedBatches) resolvedBatches.add(id)
  for (const id of passC.consumedCredits) consumedCredits.add(id)
  emit(
    'l2-fuzzy',
    'Scored the remainder and searched for split payouts',
    `${passC.resolvedBatches.size} recovered · ${passC.forAdjudication.length} still open`,
  )

  // ── Tier 4: adjudication ──────────────────────────────────────────────────
  let usage: AdjudicatorUsage = { calls: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0 }
  const stillOpen = passC.forAdjudication

  if (options.adjudicator && stillOpen.length > 0) {
    const budgeted = stillOpen.slice(0, t.maxLlmCalls)
    const overflow = stillOpen.slice(t.maxLlmCalls)

    const requests = budgeted.map(({ batch, candidates }) =>
      toRequest(batch, candidates),
    )

    let verdicts: AdjudicationVerdict[] = []
    try {
      const outcome = await options.adjudicator.adjudicate(requests)
      verdicts = outcome.verdicts
      usage = outcome.usage
    } catch (error) {
      // A provider failure must not take the run down. Everything it would have
      // judged falls through to the exception list with the reason stated.
      emit('adjudicate', 'Adjudicator unavailable', String(error))
      verdicts = []
    }

    const verdictBy = new Map(verdicts.map((v) => [v.settlementId, v]))

    for (const { batch, candidates } of budgeted) {
      const verdict = verdictBy.get(batch.settlementId)

      if (!verdict) {
        exceptions.push(...toExceptions([{ batch, candidates }], 'LLM_UNAVAILABLE'))
        continue
      }

      const legs = verdict.matchedIds
        .map((id) => candidates.find((c) => c.credit.lineId === id))
        .filter((c): c is ScoredCandidate => !!c)

      const acceptable =
        verdict.decision === 'match' &&
        legs.length > 0 &&
        verdict.confidence >= t.llmConfidenceFloor

      if (!acceptable) {
        exceptions.push({
          exceptionId: `EXC-${batch.settlementId}`,
          level: 'L2',
          recordId: batch.settlementId,
          recordKind: 'settlement_batch',
          code:
            verdict.decision === 'no_match'
              ? candidates.length === 0
                ? 'MISSING_CREDIT'
                : verdict.reasonCode || 'NO_CANDIDATE'
              : 'LOW_CONFIDENCE',
          amountPaise: batch.netPaise,
          occurredOn: batch.settledOn,
          rejected: candidates.map((c) => ({
            candidateId: c.credit.lineId,
            reason: verdict.rationale,
            deltaPaise: c.deltaPaise,
            dayGap: c.dayGap,
            score: Number(c.score.toFixed(3)),
          })),
          rationale: verdict.rationale,
          resolution: 'open',
        })
        continue
      }

      const legTotal = legs.reduce((sum, c) => sum + c.credit.creditPaise, 0)
      for (const leg of legs) {
        matches.push({
          matchId: `L2-${batch.settlementId}-${leg.credit.lineId}`,
          level: 'L2',
          leftId: batch.settlementId,
          rightId: leg.credit.lineId,
          tier: 4,
          confidence: verdict.confidence,
          // Never 'matched'. A model verdict is a proposal with a reason, and it
          // is shown to a human as one.
          state: 'review',
          evidence: [
            {
              field: 'batch net vs proposed',
              left: String(batch.netPaise),
              right: String(legTotal),
              deltaPaise: legTotal - batch.netPaise,
              agrees: legTotal === batch.netPaise,
            },
            {
              field: 'model confidence',
              left: verdict.confidence.toFixed(2),
              right: `floor ${t.llmConfidenceFloor}`,
              agrees: true,
            },
            {
              field: 'reason code',
              left: verdict.reasonCode,
              right: leg.credit.narration,
              agrees: true,
            },
          ],
          varianceCode: verdict.reasonCode || null,
          variancePaise: legTotal - batch.netPaise,
          rationale: verdict.rationale,
        })
        consumedCredits.add(leg.credit.lineId)
      }
      resolvedBatches.add(batch.settlementId)
      resolved += legs.length
    }

    if (overflow.length > 0) {
      exceptions.push(...toExceptions(overflow, 'LLM_UNAVAILABLE'))
    }

    emit(
      'adjudicate',
      `Adjudicated with ${options.adjudicator.name}`,
      `${usage.calls} call(s) · ${budgeted.length} batches judged · ${overflow.length} over budget`,
    )
  } else if (stillOpen.length > 0) {
    // Reached only when no adjudicator exists — the branch above handles the
    // case where one does. The condition that used to be tested here could
    // never be false.
    exceptions.push(...toExceptions(stillOpen, 'LLM_UNAVAILABLE'))
    emit(
      'adjudicate',
      'No adjudicator configured',
      `${stillOpen.length} batches left unresolved rather than guessed`,
    )
  }

  // A batch an earlier tier gave up on may have been rescued by a later one —
  // tier 2 records AMBIGUOUS and then lets tier 3 keep working on the same
  // batch. Without this the record carries both a match and an exception, and
  // the exception count is inflated by exactly the cases that were recovered.
  // Latent on clean data, immediate as soon as references start going missing.
  for (let i = exceptions.length - 1; i >= 0; i--) {
    if (exceptions[i].level === 'L2' && resolvedBatches.has(exceptions[i].recordId)) {
      exceptions.splice(i, 1)
    }
  }

  // ── Sweep: everything nobody claimed ──────────────────────────────────────
  for (const batch of batches) {
    if (resolvedBatches.has(batch.settlementId)) continue
    if (exceptions.some((e) => e.recordId === batch.settlementId)) continue
    exceptions.push({
      exceptionId: `EXC-${batch.settlementId}`,
      level: 'L2',
      recordId: batch.settlementId,
      recordKind: 'settlement_batch',
      code: 'MISSING_CREDIT',
      amountPaise: batch.netPaise,
      occurredOn: batch.settledOn,
      rejected: [],
      rationale: `Settlement ${batch.settlementId} (${batch.utr}) was reported by the gateway but no bank credit accounts for it.`,
      resolution: 'open',
    })
  }

  // Batches whose only exception was "no candidate" are really missing money.
  for (const exception of exceptions) {
    if (
      exception.level === 'L2' &&
      exception.code === 'NO_CANDIDATE' &&
      exception.rejected.length === 0
    ) {
      exception.code = 'MISSING_CREDIT'
    }
  }

  for (const credit of credits) {
    if (consumedCredits.has(credit.lineId)) continue
    exceptions.push({
      exceptionId: `EXC-${credit.lineId}`,
      level: 'L2',
      recordId: credit.lineId,
      recordKind: 'bank_line',
      code: 'ORPHAN_CREDIT',
      amountPaise: credit.creditPaise,
      occurredOn: credit.valueDate,
      rejected: [],
      rationale: `No settlement explains this credit. Narration: "${credit.narration}".`,
      resolution: 'open',
    })
  }
  emit('sweep', 'Swept unclaimed records', `${exceptions.length} exceptions in total`)

  // ── Grade ─────────────────────────────────────────────────────────────────
  const wallMs = performance.now() - started
  const throughput: ThroughputMetrics = {
    records: total,
    wallMs: Math.round(wallMs),
    recordsPerSecond: wallMs === 0 ? total : Math.round((total / wallMs) * 1000),
    llmCalls: usage.calls,
    llmInputTokens: usage.inputTokens,
    llmOutputTokens: usage.outputTokens,
    estCostUsd: usage.estCostUsd,
  }

  const metrics = gradeRun(dataset, matches, exceptions, throughput)
  emit(
    'grade',
    'Graded against ground truth',
    `precision ${(metrics.overall.precision * 100).toFixed(1)}% · recall ${(metrics.overall.recall * 100).toFixed(1)}%`,
  )
  emit('done', 'Run complete')

  return {
    runId: newRunId(),
    matches,
    exceptions,
    metrics,
    tolerances: t,
    adjudicatorName: options.adjudicator?.name ?? null,
    timeline,
  }
}

function toRequest(batch: SettlementBatch, candidates: ScoredCandidate[]): AdjudicationRequest {
  return {
    settlementId: batch.settlementId,
    settledOn: batch.settledOn,
    utr: batch.utr,
    netPaise: batch.netPaise,
    composition: {
      payments: batch.lines.filter((l) => l.type === 'payment').length,
      refunds: batch.lines.filter((l) => l.type === 'refund').length,
      chargebacks: batch.lines.filter((l) => l.type === 'chargeback').length,
    },
    candidates: candidates.map((c) => ({
      lineId: c.credit.lineId,
      valueDate: c.credit.valueDate,
      narration: c.credit.narration,
      creditPaise: c.credit.creditPaise,
      deltaPaise: c.deltaPaise,
      dayGap: c.dayGap,
      score: Number(c.score.toFixed(3)),
    })),
  }
}

export type { NormalizedBankLine }
