/**
 * The three sources, the matches between them, and the ground truth used to
 * grade those matches.
 *
 * All amounts are integer paise (see lib/format-money.ts). All dates are
 * `YYYY-MM-DD` day keys (see lib/format-date.ts).
 */

// ─── Source 1: the internal order ledger ─────────────────────────────────────

export type OrderStatus = 'captured' | 'refunded' | 'partially_refunded' | 'failed'

export interface Order {
  orderId: string
  customer: string
  grossPaise: number
  currency: 'INR'
  capturedOn: string
  /** The gateway payment id as the merchant recorded it. May be absent. */
  paymentRef: string | null
  status: OrderStatus
}

// ─── Source 2: the payment-gateway settlement report ─────────────────────────

export type SettlementType = 'payment' | 'refund' | 'chargeback' | 'adjustment'

export interface SettlementLine {
  lineId: string
  /** The payout batch this line was included in. */
  settlementId: string
  paymentRef: string
  type: SettlementType
  /** Negative for refunds and chargebacks. */
  grossPaise: number
  feePaise: number
  /** GST on the fee. */
  taxPaise: number
  /** gross − fee − tax. What the gateway says it actually paid out. */
  netPaise: number
  settledOn: string
  /** Bank reference for the whole batch. Shared by every line in it. */
  utr: string
}

/** A payout batch — the unit that actually reaches the bank. */
export interface SettlementBatch {
  settlementId: string
  utr: string
  settledOn: string
  lines: SettlementLine[]
  /** Sum of netPaise across every line, refunds and chargebacks included. */
  netPaise: number
}

// ─── Source 3: the bank statement ────────────────────────────────────────────

export interface BankLine {
  lineId: string
  valueDate: string
  narration: string
  creditPaise: number
  debitPaise: number
  balancePaise: number
}

// ─── What the engine produces ────────────────────────────────────────────────

export type MatchTier = 0 | 1 | 2 | 3 | 4
export type MatchLevel = 'L1' | 'L2'

/** `L1` = order ↔ settlement line. `L2` = settlement batch ↔ bank line. */
export type MatchState = 'matched' | 'review' | 'exception'

export interface EvidenceItem {
  field: string
  left: string
  right: string
  /** Signed paise difference, when the field is an amount. */
  deltaPaise?: number
  agrees: boolean
}

export interface Match {
  matchId: string
  level: MatchLevel
  /** orderId (L1) or settlementId (L2). */
  leftId: string
  /** lineId (L1) or bank lineId (L2). */
  rightId: string
  tier: MatchTier
  confidence: number
  state: MatchState
  evidence: EvidenceItem[]
  /** Set when a correct match still carries a money variance worth reporting. */
  varianceCode: string | null
  variancePaise: number
  /** Present only for tier-4 verdicts. */
  rationale: string | null
}

export interface ReconException {
  exceptionId: string
  level: MatchLevel
  /** The record that could not be resolved. */
  recordId: string
  recordKind: 'order' | 'settlement_batch' | 'bank_line'
  code: string
  amountPaise: number
  /** Day key of the record, for aging. */
  occurredOn: string
  /** Candidates the engine considered and rejected, with the reason. */
  rejected: RejectedCandidate[]
  rationale: string | null
  resolution: 'open' | 'accepted' | 'rejected' | 'reassigned'
}

export interface RejectedCandidate {
  candidateId: string
  reason: string
  deltaPaise: number
  dayGap: number
  score: number
}

// ─── Ground truth ────────────────────────────────────────────────────────────

/**
 * Emitted by the generator, never read by the engine. Only lib/recon/metrics.ts
 * touches it. A pair is (left, right); a split payout contributes two L2 pairs
 * for the same settlement, so recall counts each leg.
 */
export interface GroundTruth {
  l1Pairs: [string, string][]
  l2Pairs: [string, string][]
  /** recordId → the exception class deliberately planted on it. */
  plantedClass: Record<string, string>
}

export interface Dataset {
  orders: Order[]
  settlements: SettlementLine[]
  bankLines: BankLine[]
  truth: GroundTruth
  meta: {
    seed: number
    orderCount: number
    startDay: string
    days: number
    generatedAt: string
  }
}
