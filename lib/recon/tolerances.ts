/**
 * Every number the engine is allowed to be lenient about, in one place.
 *
 * These are the dials the Rules page edits. They are the single most honest
 * thing in the product: loosening them raises the match rate and lowers
 * precision, and because the scorecard grades against ground truth you can
 * watch that trade happen instead of arguing about it.
 */

export interface Tolerances {
  /** Absolute paise a batch total may differ from a bank credit and still match. */
  roundingPaise: number
  /** Relative allowance, in basis points, for larger amounts. */
  amountBps: number
  /** How many business days after settledOn a credit may land. */
  dateWindowDays: number
  /** Contracted gateway fee, in basis points of gross. */
  feeBps: number
  /** GST applied to the fee, as a rate. */
  feeTaxRate: number
  /** Fee variance beyond this (bps) is reported as FEE_DRIFT. */
  feeDriftBps: number
  /** Minimum tier-3 score to auto-accept without asking the model. */
  fuzzyAcceptScore: number
  /** Minimum tier-4 model confidence to record a match rather than an exception. */
  llmConfidenceFloor: number
  /** Two candidates within this score of each other are AMBIGUOUS, not a match. */
  ambiguityMargin: number
  /** Largest number of bank credits that may be summed to satisfy one batch. */
  maxSplitLegs: number
  /** Hard cap on adjudicator calls, so one bad batch cannot burn a day's quota. */
  maxLlmCalls: number
}

export const DEFAULT_TOLERANCES: Tolerances = {
  roundingPaise: 300,
  amountBps: 25,
  dateWindowDays: 3,
  feeBps: 200,
  feeTaxRate: 0.18,
  feeDriftBps: 5,
  fuzzyAcceptScore: 0.82,
  llmConfidenceFloor: Number(process.env.LLM_CONFIDENCE_FLOOR ?? 0.75),
  ambiguityMargin: 0.04,
  maxSplitLegs: 3,
  maxLlmCalls: Number(process.env.LLM_MAX_CALLS_PER_RUN ?? 40),
}

/**
 * A deliberately reckless profile. The adversarial check in the verification
 * plan runs with this: if the scorecard still reports zero false positives when
 * the engine is allowed to match anything within ₹500 and a fortnight, then the
 * scorecard is decorative and the numbers on it mean nothing.
 */
export const RECKLESS_TOLERANCES: Tolerances = {
  ...DEFAULT_TOLERANCES,
  roundingPaise: 50_000,
  amountBps: 500,
  dateWindowDays: 14,
  fuzzyAcceptScore: 0.35,
  llmConfidenceFloor: 0.2,
  ambiguityMargin: 0,
}

/** The absolute paise two amounts may differ by, given the larger of the two. */
export function allowedDelta(amountPaise: number, t: Tolerances): number {
  const relative = Math.abs(amountPaise) * (t.amountBps / 10_000)
  return Math.max(t.roundingPaise, Math.round(relative))
}

export function mergeTolerances(partial: Partial<Tolerances> | null | undefined): Tolerances {
  return { ...DEFAULT_TOLERANCES, ...(partial ?? {}) }
}
