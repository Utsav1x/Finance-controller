/**
 * The exception taxonomy.
 *
 * Two groups live here and they are deliberately kept in one table:
 *
 *   - Planted classes — real-world failure modes the generator injects and the
 *     engine is expected to survive or correctly report.
 *   - Engine outcomes  — why *this* engine gave up on *this* record.
 *
 * A demo that only had the second group would be reporting on itself. Keeping
 * both in the same vocabulary is what lets the scorecard say "we found 9 of the
 * 11 planted split payouts" rather than only "2 records were unmatched".
 */

export type Severity = 'high' | 'medium' | 'low'

export interface ReasonCode {
  code: string
  label: string
  severity: Severity
  /** What actually happened in the data. */
  description: string
  /** What a human should do about it. Shown in the exception queue. */
  action: string
  /** Planted by the generator, or produced by the engine. */
  origin: 'planted' | 'engine'
}

export const REASON_CODES: Record<string, ReasonCode> = {
  // ── Planted classes ────────────────────────────────────────────────────────
  FEE_DRIFT: {
    code: 'FEE_DRIFT',
    label: 'Fee drift',
    severity: 'medium',
    description:
      'The gateway deducted a different fee rate than the contracted one. The match is correct; the money is not.',
    action: 'Confirm the rate change with the gateway and raise a credit note for the difference.',
    origin: 'planted',
  },
  TIMING_GAP: {
    code: 'TIMING_GAP',
    label: 'Timing gap',
    severity: 'low',
    description:
      'The payout reached the bank later than the settlement date implies, usually across a weekend or bank holiday.',
    action: 'No action if inside the agreed T+n window. Escalate if it is a repeat offender.',
    origin: 'planted',
  },
  PARTIAL_REFUND: {
    code: 'PARTIAL_REFUND',
    label: 'Partial refund in batch',
    severity: 'medium',
    description:
      'A refund netted off inside the payout, so the bank credit is smaller than the gross payments suggest.',
    action: 'Verify the refund against the order, then post it to the refunds account.',
    origin: 'planted',
  },
  CHARGEBACK: {
    code: 'CHARGEBACK',
    label: 'Chargeback deduction',
    severity: 'high',
    description:
      'A chargeback was netted against an otherwise clean payout, reducing the credit.',
    action: 'Open a dispute file and reserve against the order. Do not write off silently.',
    origin: 'planted',
  },
  DUPLICATE_CAPTURE: {
    code: 'DUPLICATE_CAPTURE',
    label: 'Duplicate capture',
    severity: 'high',
    description:
      'The same payment reference appears on more than one order. At most one of them was really paid.',
    action: 'Void the duplicate order and, if the customer was charged twice, refund it.',
    origin: 'planted',
  },
  MISSING_CREDIT: {
    code: 'MISSING_CREDIT',
    label: 'Payout never landed',
    severity: 'high',
    description:
      'The gateway reported a settlement that has no corresponding bank credit. This is real money that has not arrived.',
    action: 'Raise with the gateway immediately, quoting the UTR. Track as a receivable until it lands.',
    origin: 'planted',
  },
  ORPHAN_CREDIT: {
    code: 'ORPHAN_CREDIT',
    label: 'Unidentified bank credit',
    severity: 'medium',
    description:
      'Money arrived that no settlement explains — a direct transfer, a rebate, or another source entirely.',
    action: 'Identify the payer from the narration and post it to the right account. Never leave it suspense.',
    origin: 'planted',
  },
  ROUNDING: {
    code: 'ROUNDING',
    label: 'Rounding drift',
    severity: 'low',
    description:
      'The batch total and the bank credit differ by a few paise from per-line rounding.',
    action: 'Absorb to a rounding account. Investigate only if the drift is systematic.',
    origin: 'planted',
  },
  NARRATION_NOISE: {
    code: 'NARRATION_NOISE',
    label: 'Unreadable narration',
    severity: 'low',
    description:
      'The bank reference is present but mangled — truncated, spaced, or transposed — so a literal reference match fails.',
    action: 'None if the amount-and-date match is sound. Worth reporting to the bank if frequent.',
    origin: 'planted',
  },
  SPLIT_PAYOUT: {
    code: 'SPLIT_PAYOUT',
    label: 'Split payout',
    severity: 'medium',
    description:
      'One settlement was paid out as two or more separate bank credits, so no single credit equals the batch total.',
    action: 'Confirm the legs sum to the batch and record them as one settlement.',
    origin: 'planted',
  },

  // ── Engine outcomes ───────────────────────────────────────────────────────
  NO_CANDIDATE: {
    code: 'NO_CANDIDATE',
    label: 'No candidate found',
    severity: 'high',
    description:
      'Nothing in the opposing source came close enough on amount or date to be worth considering.',
    action: 'Check the source extract is complete for this period before investigating the record.',
    origin: 'engine',
  },
  AMBIGUOUS: {
    code: 'AMBIGUOUS',
    label: 'Ambiguous — several equal candidates',
    severity: 'medium',
    description:
      'Two or more candidates scored within a hair of each other. Picking one would be a coin flip presented as a fact.',
    action: 'Pick the right one from the candidate list; the choice is recorded as a labelled example.',
    origin: 'engine',
  },
  LOW_CONFIDENCE: {
    code: 'LOW_CONFIDENCE',
    label: 'Below confidence floor',
    severity: 'medium',
    description:
      'A candidate was found and the model judged it, but the verdict did not clear the floor required to auto-accept.',
    action: 'Accept or reject the proposal. Either way it becomes training signal for the next run.',
    origin: 'engine',
  },
  LLM_UNAVAILABLE: {
    code: 'LLM_UNAVAILABLE',
    label: 'Adjudicator unavailable',
    severity: 'medium',
    description:
      'The deterministic tiers could not resolve this and no AI provider was reachable, so it was left unresolved rather than guessed.',
    action: 'Set GOOGLE_AI_API_KEY and re-run, or resolve by hand.',
    origin: 'engine',
  },
}

export const PLANTED_CODES = Object.values(REASON_CODES)
  .filter((r) => r.origin === 'planted')
  .map((r) => r.code)

export function reasonCode(code: string): ReasonCode {
  return (
    REASON_CODES[code] ?? {
      code,
      label: code,
      severity: 'medium',
      description: 'No description registered for this code.',
      action: 'Investigate manually.',
      origin: 'engine',
    }
  )
}

export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
