/**
 * Every read and write the app performs. Server-only.
 */

import { rows, row, run as exec, transaction } from './client'
import type { Dataset, Match, ReconException } from '@/lib/recon/types'
import type { RunMetrics } from '@/lib/recon/metrics'
import type { ProgressEvent, RunResult } from '@/lib/recon/engine'
import type { Tolerances } from '@/lib/recon/tolerances'
import { DEFAULT_TOLERANCES } from '@/lib/recon/tolerances'

export interface RunSummary {
  id: string
  label: string
  createdAt: string
  seed: number
  orderCount: number
  adjudicator: string | null
  metrics: RunMetrics
  autoMatchRate: number
  openExceptions: number
}

export interface StoredRun extends RunSummary {
  tolerances: Tolerances
  timeline: ProgressEvent[]
  dataset: Dataset
  matches: Match[]
  exceptions: (ReconException & { note: string | null; resolvedAt: string | null })[]
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export function saveRun(result: RunResult, dataset: Dataset, label: string): string {
  transaction(() => {
    exec(
      `INSERT INTO runs (id, label, created_at, seed, order_count, tolerances, adjudicator, metrics, timeline, dataset)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      result.runId,
      label,
      new Date().toISOString(),
      dataset.meta.seed,
      dataset.meta.orderCount,
      JSON.stringify(result.tolerances),
      result.adjudicatorName,
      JSON.stringify(result.metrics),
      JSON.stringify(result.timeline),
      JSON.stringify(dataset),
    )

    for (const m of result.matches) {
      exec(
        `INSERT INTO matches (run_id, match_id, level, left_id, right_id, tier, confidence, state, variance_code, variance_paise, rationale, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        result.runId,
        m.matchId,
        m.level,
        m.leftId,
        m.rightId,
        m.tier,
        m.confidence,
        m.state,
        m.varianceCode,
        m.variancePaise,
        m.rationale,
        JSON.stringify(m.evidence),
      )
    }

    for (const e of result.exceptions) {
      exec(
        `INSERT INTO exceptions (run_id, exception_id, level, record_id, record_kind, code, amount_paise, occurred_on, rejected, rationale, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        result.runId,
        e.exceptionId,
        e.level,
        e.recordId,
        e.recordKind,
        e.code,
        e.amountPaise,
        e.occurredOn,
        JSON.stringify(e.rejected),
        e.rationale,
        e.resolution,
      )
    }

    for (const event of result.timeline) {
      exec(
        `INSERT INTO agent_log (run_id, at, kind, label, detail) VALUES (?, ?, ?, ?, ?)`,
        result.runId,
        new Date().toISOString(),
        event.stage,
        event.label,
        event.detail ?? null,
      )
    }
  })

  return result.runId
}

export function logAgentEvent(
  runId: string,
  kind: string,
  label: string,
  detail?: string,
): void {
  exec(
    `INSERT INTO agent_log (run_id, at, kind, label, detail) VALUES (?, ?, ?, ?, ?)`,
    runId,
    new Date().toISOString(),
    kind,
    label,
    detail ?? null,
  )
}

export function resolveException(
  runId: string,
  exceptionId: string,
  resolution: 'open' | 'accepted' | 'rejected' | 'reassigned',
  note?: string,
): void {
  exec(
    `UPDATE exceptions SET resolution = ?, resolved_at = ?, note = ? WHERE run_id = ? AND exception_id = ?`,
    resolution,
    resolution === 'open' ? null : new Date().toISOString(),
    note ?? null,
    runId,
    exceptionId,
  )
}

export function deleteRun(runId: string): void {
  exec(`DELETE FROM runs WHERE id = ?`, runId)
}

// ─── Reads ───────────────────────────────────────────────────────────────────

interface RunRow {
  id: string
  label: string
  created_at: string
  seed: number
  order_count: number
  tolerances: string
  adjudicator: string | null
  metrics: string
  timeline: string
  dataset: string
  open_exceptions: number
}

function toSummary(r: RunRow): RunSummary {
  const metrics = JSON.parse(r.metrics) as RunMetrics
  return {
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    seed: r.seed,
    orderCount: r.order_count,
    adjudicator: r.adjudicator,
    metrics,
    autoMatchRate: metrics.resolution.autoMatchRate,
    openExceptions: r.open_exceptions ?? 0,
  }
}

/** Summaries only — the dataset blob is not read, so this stays cheap. */
export function listRuns(limit = 25): RunSummary[] {
  return rows<RunRow>(
    `SELECT r.id, r.label, r.created_at, r.seed, r.order_count, r.adjudicator, r.metrics,
            '' AS tolerances, '' AS timeline, '' AS dataset,
            (SELECT COUNT(*) FROM exceptions e WHERE e.run_id = r.id AND e.resolution = 'open') AS open_exceptions
       FROM runs r
      ORDER BY r.created_at DESC
      LIMIT ?`,
    limit,
  ).map(toSummary)
}

export function getRun(runId: string): StoredRun | null {
  const r = row<RunRow>(
    `SELECT r.*,
            (SELECT COUNT(*) FROM exceptions e WHERE e.run_id = r.id AND e.resolution = 'open') AS open_exceptions
       FROM runs r WHERE r.id = ?`,
    runId,
  )
  if (!r) return null

  return {
    ...toSummary(r),
    tolerances: JSON.parse(r.tolerances) as Tolerances,
    timeline: JSON.parse(r.timeline) as ProgressEvent[],
    dataset: JSON.parse(r.dataset) as Dataset,
    matches: getMatches(runId),
    exceptions: getExceptions(runId),
  }
}

/** The most recent run, for the dashboard and the sidebar card. */
export function latestRun(): RunSummary | null {
  return listRuns(1)[0] ?? null
}

export function getMatches(runId: string): Match[] {
  return rows<{
    match_id: string
    level: string
    left_id: string
    right_id: string
    tier: number
    confidence: number
    state: string
    variance_code: string | null
    variance_paise: number
    rationale: string | null
    evidence: string
  }>(`SELECT * FROM matches WHERE run_id = ? ORDER BY level, left_id`, runId).map((m) => ({
    matchId: m.match_id,
    level: m.level as Match['level'],
    leftId: m.left_id,
    rightId: m.right_id,
    tier: m.tier as Match['tier'],
    confidence: m.confidence,
    state: m.state as Match['state'],
    varianceCode: m.variance_code,
    variancePaise: m.variance_paise,
    rationale: m.rationale,
    evidence: JSON.parse(m.evidence),
  }))
}

export function getExceptions(
  runId: string,
): (ReconException & { note: string | null; resolvedAt: string | null })[] {
  return rows<{
    exception_id: string
    level: string
    record_id: string
    record_kind: string
    code: string
    amount_paise: number
    occurred_on: string
    rejected: string
    rationale: string | null
    resolution: string
    resolved_at: string | null
    note: string | null
  }>(
    `SELECT * FROM exceptions WHERE run_id = ? ORDER BY amount_paise DESC`,
    runId,
  ).map((e) => ({
    exceptionId: e.exception_id,
    level: e.level as ReconException['level'],
    recordId: e.record_id,
    recordKind: e.record_kind as ReconException['recordKind'],
    code: e.code,
    amountPaise: e.amount_paise,
    occurredOn: e.occurred_on,
    rejected: JSON.parse(e.rejected),
    rationale: e.rationale,
    resolution: e.resolution as ReconException['resolution'],
    resolvedAt: e.resolved_at,
    note: e.note,
  }))
}

export function getAgentLog(runId: string) {
  return rows<{ id: number; at: string; kind: string; label: string; detail: string | null }>(
    `SELECT id, at, kind, label, detail FROM agent_log WHERE run_id = ? ORDER BY id`,
    runId,
  )
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export function getTolerances(): Tolerances {
  const r = row<{ tolerances: string }>(`SELECT tolerances FROM rules WHERE id = 1`)
  if (!r) return DEFAULT_TOLERANCES
  return { ...DEFAULT_TOLERANCES, ...(JSON.parse(r.tolerances) as Partial<Tolerances>) }
}

export function saveTolerances(t: Tolerances): void {
  exec(
    `INSERT INTO rules (id, tolerances, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET tolerances = excluded.tolerances, updated_at = excluded.updated_at`,
    JSON.stringify(t),
    new Date().toISOString(),
  )
}
