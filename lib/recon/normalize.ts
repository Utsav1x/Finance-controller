/**
 * Tier 0 — turn three differently-shaped exports into comparable keys.
 *
 * Most of the difficulty in reconciliation is not the matching, it is that the
 * same fact is written three different ways. A bank narration is a single
 * free-text field carrying a reference that a human can see and a `===` cannot.
 * Everything here exists to extract a comparable key without ever *discarding*
 * the original, so that when a match is questioned the evidence trail can show
 * the raw narration next to what we made of it.
 */

import type { SettlementLine, SettlementBatch, BankLine } from './types'

// ─── Batching ────────────────────────────────────────────────────────────────

/**
 * The payout batch is the real unit of settlement — the bank sees one credit
 * for a whole day of payments, net of every refund and chargeback that settled
 * alongside them. Summing only the payments is the single most common way to
 * build a matcher that works on clean data and collapses on real data.
 */
export function buildBatches(lines: SettlementLine[]): SettlementBatch[] {
  const map = new Map<string, SettlementBatch>()

  for (const line of lines) {
    let batch = map.get(line.settlementId)
    if (!batch) {
      batch = {
        settlementId: line.settlementId,
        utr: line.utr,
        settledOn: line.settledOn,
        lines: [],
        netPaise: 0,
      }
      map.set(line.settlementId, batch)
    }
    batch.lines.push(line)
    batch.netPaise += line.netPaise
  }

  return [...map.values()].sort((a, b) => a.settledOn.localeCompare(b.settledOn))
}

// ─── Reference extraction ────────────────────────────────────────────────────

/** Well-formed references, in the order we trust them. */
const UTR_PATTERN = /UTR\s?([0-9]{9,14})/i

/**
 * Any run of 8+ digits. Used only after the strict pattern fails — a truncated
 * or space-split UTR still leaves a long digit run behind, and that run is what
 * the similarity check works on.
 */
const DIGIT_RUN = /\d{8,}/g

export interface NarrationFacts {
  raw: string
  /** The reference if it parsed cleanly. */
  utr: string | null
  /** Every long digit run, whether or not it parsed as a UTR. */
  digitRuns: string[]
  /** Uppercased alphabetic tokens, stopwords removed. */
  tokens: string[]
}

const STOPWORDS = new Set([
  'NEFT', 'IMPS', 'RTGS', 'ACH', 'CR', 'DR', 'UTR', 'REF', 'TXN', 'PVT', 'LTD',
  'THE', 'AND', 'FROM', 'FOR',
])

export function parseNarration(narration: string): NarrationFacts {
  const compact = narration.replace(/\s+/g, ' ').trim()
  const strict = compact.match(UTR_PATTERN)

  return {
    raw: narration,
    utr: strict ? `UTR${strict[1]}` : null,
    digitRuns: [...compact.replace(/\s/g, '').matchAll(DIGIT_RUN)].map((m) => m[0]),
    tokens: compact
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  }
}

// ─── Similarity ──────────────────────────────────────────────────────────────

/** Levenshtein, capped — we only care whether two references are *close*. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr.slice()
  }
  return prev[b.length]
}

/**
 * How well a bank narration supports a given UTR, in 0..1.
 *
 * A clean hit scores 1. A truncated, spaced or transposed reference — the
 * NARRATION_NOISE class — still scores high because the digit run survives the
 * mangling even when the literal string does not. A narration with no long
 * digit run at all scores 0, which is what keeps unrelated credits from
 * drifting into candidacy on amount alone.
 */
export function referenceSupport(facts: NarrationFacts, utr: string): number {
  if (facts.utr === utr) return 1

  const target = utr.replace(/^UTR/, '')
  if (facts.digitRuns.length === 0) return 0

  let best = 0
  for (const run of facts.digitRuns) {
    const distance = editDistance(run, target)
    const span = Math.max(run.length, target.length)
    const score = 1 - distance / span
    if (score > best) best = score
  }
  // Below this the "match" is coincidence between two long numbers.
  return best < 0.6 ? 0 : best
}

/** Jaccard overlap of alphabetic tokens. Used to keep orphans out. */
export function tokenOverlap(a: NarrationFacts, b: readonly string[]): number {
  if (a.tokens.length === 0 || b.length === 0) return 0
  const left = new Set(a.tokens)
  const right = new Set(b)
  let shared = 0
  for (const t of left) if (right.has(t)) shared++
  return shared / (left.size + right.size - shared)
}

// ─── Statement partitioning ──────────────────────────────────────────────────

export interface NormalizedBankLine extends BankLine {
  facts: NarrationFacts
}

/**
 * Only credits can settle a payout. Debits are carried through the run so the
 * cash view and the audit trail stay complete, but they never enter candidacy —
 * an engine that scored every statement line against every batch would be
 * slower and would eventually match a payout to a vendor payment.
 */
export function partitionStatement(lines: BankLine[]): {
  credits: NormalizedBankLine[]
  debits: BankLine[]
} {
  const credits: NormalizedBankLine[] = []
  const debits: BankLine[] = []

  for (const line of lines) {
    if (line.creditPaise > 0) {
      credits.push({ ...line, facts: parseNarration(line.narration) })
    } else {
      debits.push(line)
    }
  }
  return { credits, debits }
}
