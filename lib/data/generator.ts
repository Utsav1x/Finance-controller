/**
 * Seeded synthetic data generator for the three reconciliation sources.
 *
 * Two properties matter more than realism here:
 *
 *   1. **Determinism.** Everything derives from one integer seed, so a run is
 *      reproducible from a number stored in the run record. "It worked on my
 *      machine" is not a defence you can offer about a match rate.
 *
 *   2. **Ground truth.** Every true relationship is recorded as the data is
 *      built, before the engine ever sees it. Without this the engine can only
 *      grade itself, and a self-graded match rate is just a count of the times
 *      the engine felt confident — which is exactly the number a bad matcher
 *      maximises.
 *
 * Clean data is generated first, then each exception class is planted on top by
 * mutating specific records. Planting order is fixed and the exceptions are
 * applied at the layer they really occur at — fee drift before the batch totals
 * are computed, split payouts after — so the downstream effects (a smaller bank
 * credit, a batch that no single credit satisfies) fall out naturally instead of
 * being hand-written.
 */

import type {
  BankLine,
  Dataset,
  GroundTruth,
  Order,
  SettlementLine,
} from '@/lib/recon/types'
import { addBusinessDays, addDays, isBusinessDay } from '@/lib/format-date'

// ─── Deterministic PRNG ──────────────────────────────────────────────────────

/** mulberry32 — small, fast, and identical across platforms and Node versions. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function rand(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Rng {
  private next: () => number
  constructor(seed: number) {
    this.next = mulberry32(seed)
  }
  float(): number {
    return this.next()
  }
  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]
  }
  /** Distinct indices into a collection of `length`, at most `count` of them. */
  sample(length: number, count: number): number[] {
    const n = Math.min(count, length)
    const idx = Array.from({ length }, (_, i) => i)
    for (let i = length - 1; i > 0; i--) {
      const j = this.int(0, i)
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    return idx.slice(0, n).sort((a, b) => a - b)
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

export type PlantedCode =
  | 'FEE_DRIFT'
  | 'TIMING_GAP'
  | 'PARTIAL_REFUND'
  | 'CHARGEBACK'
  | 'DUPLICATE_CAPTURE'
  | 'MISSING_CREDIT'
  | 'ORPHAN_CREDIT'
  | 'ROUNDING'
  | 'NARRATION_NOISE'
  | 'SPLIT_PAYOUT'

export interface GeneratorConfig {
  seed: number
  orderCount: number
  startDay: string
  days: number
  /**
   * Settlement cycles per business day. A gateway paying out once a day gives
   * a 200-order month only ~17 payouts, which makes the batch-matching problem
   * — the hard half of this exercise — statistically trivial. High-volume
   * merchants really are settled several times a day, so three is both more
   * realistic and a fairer test.
   */
  settlementsPerDay: number
  /**
   * Fraction of payouts whose bank reference is lost entirely in the export,
   * and which are then delayed past the date window — "hard mode".
   *
   * This exists because a clean dataset is resolved completely by the
   * deterministic tiers, which makes the adjudicator look like decoration. The
   * combination is what makes a case genuinely un-ruleable: tier 1 has no
   * reference to match, tier 2 rejects the credit on date, and tier 3 scores it
   * around 0.49 against a 0.82 bar. What reaches tier 4 is a credit whose
   * amount matches exactly and whose only remaining evidence is the narration
   * text — `RAZORPAY ... SETTLEMENT` against a decoy's `PAYU ... PAYOUT`.
   *
   * That is a judgement a numeric rule cannot make and a reader makes
   * instantly, which is the honest case for having a model in the loop at all.
   * At 0 (the default) the dataset is unchanged.
   */
  referenceLoss: number
  /** Contracted fee, basis points of gross. */
  feeBps: number
  /** GST on the fee. */
  feeTaxRate: number
  /** Absolute counts per class. Omitted classes scale with the population they apply to. */
  plant?: Partial<Record<PlantedCode, number>>
}

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  seed: 42,
  orderCount: 220,
  startDay: '2026-08-03',
  days: 20,
  settlementsPerDay: 3,
  referenceLoss: 0,
  feeBps: 200,
  feeTaxRate: 0.18,
}

/**
 * Plant counts scale with the population each class can actually occur in, and
 * those populations are different sizes.
 *
 * Fee drift happens per payment; a payout that never lands happens per batch.
 * Scaling both off the order count is what made an earlier version silently
 * plant zero of the batch-level classes — it asked for eleven mangled
 * narrations from a pool of six remaining payouts, got none, and the scorecard
 * cheerfully reported perfect recall on a class that was never tested.
 */
const ORDER_LEVEL_RATIO: Record<string, number> = {
  FEE_DRIFT: 0.09,
  PARTIAL_REFUND: 0.05,
  CHARGEBACK: 0.02,
  DUPLICATE_CAPTURE: 0.02,
}

const BATCH_LEVEL_RATIO: Record<string, number> = {
  TIMING_GAP: 0.12,
  ROUNDING: 0.1,
  NARRATION_NOISE: 0.12,
  SPLIT_PAYOUT: 0.08,
  MISSING_CREDIT: 0.05,
  ORPHAN_CREDIT: 0.1,
}

function countsFor(
  ratios: Record<string, number>,
  population: number,
  overrides: Partial<Record<PlantedCode, number>> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [code, ratio] of Object.entries(ratios)) {
    out[code] = overrides?.[code as PlantedCode] ?? Math.max(1, Math.round(population * ratio))
  }
  return out
}

// ─── Reference data ──────────────────────────────────────────────────────────

const CUSTOMERS = [
  'Anika Rao', 'Rohan Mehta', 'Priya Nair', 'Vikram Shetty', 'Sneha Iyer',
  'Arjun Bhatia', 'Kavya Reddy', 'Imran Sheikh', 'Neha Kulkarni', 'Aditya Rane',
  'Meera Pillai', 'Sahil Kapoor', 'Divya Menon', 'Karthik Subramanian', 'Riya Joshi',
  'Manav Trivedi', 'Ishita Ghosh', 'Nikhil Deshpande', 'Tara Fernandes', 'Yash Agarwal',
  'Pooja Chandran', 'Devansh Saxena', 'Ananya Bose', 'Harsh Vora', 'Lakshmi Krishnan',
  'Zoya Ansari', 'Siddharth Patel', 'Aarti Malhotra', 'Rahul Chatterjee', 'Nandini Rao',
  'Farhan Qureshi', 'Shreya Banerjee', 'Aman Gupta', 'Ritika Sharma', 'Varun Nambiar',
  'Sanya Dutta', 'Kabir Singh', 'Ela Mathew', 'Gaurav Jain', 'Trisha Menon',
]

const VENDOR_DEBITS = [
  'NEFT DR AWS INDIA CLOUD SERVICES',
  'NEFT DR MEESHO LOGISTICS PVT LTD',
  'IMPS DR OFFICE RENT AUG',
  'NEFT DR SALARY BATCH PAYROLL',
  'ACH DR GSTN TAX PAYMENT',
  'NEFT DR SHIPROCKET COURIER',
]

const ORPHAN_NARRATIONS = [
  'NEFT CR ACME RETAIL PVT LTD INV-2231 DIRECT',
  'IMPS CR REFUND FROM SHIPPING PARTNER',
  'NEFT CR MARKETPLACE REBATE Q2 INCENTIVE',
  'RTGS CR SECURITY DEPOSIT RELEASE LANDLORD',
  'NEFT CR INSURANCE CLAIM SETTLEMENT MOTOR',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/** A realistic order value: mostly small, occasionally large. */
function orderAmount(rng: Rng): number {
  const roll = rng.float()
  if (roll < 0.7) return rng.int(199, 4999) * 100
  if (roll < 0.95) return rng.int(5000, 24999) * 100
  return rng.int(25000, 99999) * 100
}

/** Walk forward from `startDay` to the nth business day in the window. */
function businessDaysIn(startDay: string, days: number): string[] {
  const out: string[] = []
  let cursor = startDay
  for (let i = 0; i < days; i++) {
    if (isBusinessDay(cursor)) out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

/** Mangle a UTR the way a bank statement export does. */
function mangleUtr(utr: string, rng: Rng): string {
  const mode = rng.int(0, 2)
  if (mode === 0) return utr.slice(0, utr.length - 3) // truncated
  if (mode === 1) return `${utr.slice(0, 6)} ${utr.slice(6)}` // stray space
  // transposed pair
  const i = rng.int(4, utr.length - 2)
  return utr.slice(0, i) + utr[i + 1] + utr[i] + utr.slice(i + 2)
}

// ─── Generator ───────────────────────────────────────────────────────────────

/** Bank lines are built without ids, then dated, sorted and numbered at the end. */
interface DraftBankLine {
  valueDate: string
  narration: string
  creditPaise: number
  debitPaise: number
  /** The settlement this credit really came from. null for orphans and debits. */
  truthSettlementId: string | null
  plantedClass: PlantedCode | null
  lineId?: string
}

export function generateDataset(config: Partial<GeneratorConfig> = {}): Dataset {
  const cfg: GeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG, ...config }
  const rng = new Rng(cfg.seed)
  const orderCounts = countsFor(ORDER_LEVEL_RATIO, cfg.orderCount, cfg.plant)
  const plantedClass: Record<string, string> = {}

  const tradingDays = businessDaysIn(cfg.startDay, cfg.days)
  if (tradingDays.length === 0) {
    throw new Error(`[generator] no business days in ${cfg.days} days from ${cfg.startDay}`)
  }

  // ── Phase A — orders ──────────────────────────────────────────────────────
  const orders: Order[] = []
  for (let i = 0; i < cfg.orderCount; i++) {
    const capturedOn = rng.pick(tradingDays)
    orders.push({
      orderId: `ORD-${pad(i + 1, 5)}`,
      customer: rng.pick(CUSTOMERS),
      grossPaise: orderAmount(rng),
      currency: 'INR',
      capturedOn,
      paymentRef: `pay_${pad(rng.int(0, 999999999), 9)}`,
      status: 'captured',
    })
  }
  orders.sort((a, b) => a.capturedOn.localeCompare(b.capturedOn) || a.orderId.localeCompare(b.orderId))

  // ── Phase B — settlement lines at the contracted rate ─────────────────────
  const byOrderId = new Map(orders.map((o) => [o.orderId, o]))
  const settlements: SettlementLine[] = []
  const l1Pairs: [string, string][] = []

  /** lineId → `YYYY-MM-DD#cycle`, the payout this line will be paid in. */
  const batchKeyOf = new Map<string, string>()

  orders.forEach((order, i) => {
    const fee = Math.round((order.grossPaise * cfg.feeBps) / 10_000)
    const tax = Math.round(fee * cfg.feeTaxRate)
    const settledOn = addBusinessDays(order.capturedOn, 2)
    const cycle = rng.int(0, cfg.settlementsPerDay - 1)
    const line: SettlementLine = {
      lineId: `STL-${pad(i + 1, 5)}`,
      settlementId: '', // assigned when batches are formed
      paymentRef: order.paymentRef!,
      type: 'payment',
      grossPaise: order.grossPaise,
      feePaise: fee,
      taxPaise: tax,
      netPaise: order.grossPaise - fee - tax,
      settledOn,
      utr: '',
    }
    settlements.push(line)
    batchKeyOf.set(line.lineId, `${settledOn}#${cycle}`)
    l1Pairs.push([order.orderId, line.lineId])
  })

  /**
   * The payouts that actually exist, in order. Reversals are assigned to one of
   * these rather than being allowed to invent their own.
   *
   * A batch made only of refunds nets to a negative number, and a negative
   * payout is not a bank credit — the gateway carries it forward and recovers
   * it from the next one. Letting refunds create their own settlement day
   * produced exactly that impossible record, which then showed up as a payout
   * that never landed and quietly cost two points of recall.
   */
  const paymentKeys = [...new Set(batchKeyOf.values())].sort()
  const keyIndex = new Map(paymentKeys.map((k, i) => [k, i]))

  // ── Phase C — exceptions that change what the gateway paid out ────────────

  // FEE_DRIFT: the rate quietly moves partway through the period. The match
  // stays correct; the money does not. This is the leakage case — nothing is
  // unmatched, so a match-rate-only report would show a perfect day.
  const driftFromDay = tradingDays[Math.floor(tradingDays.length / 2)]
  const driftBps = cfg.feeBps + rng.int(15, 40)
  const eligible = settlements.filter((s) => s.settledOn >= driftFromDay)
  for (const i of rng.sample(eligible.length, orderCounts.FEE_DRIFT)) {
    const line = eligible[i]
    const fee = Math.round((line.grossPaise * driftBps) / 10_000)
    const tax = Math.round(fee * cfg.feeTaxRate)
    line.feePaise = fee
    line.taxPaise = tax
    line.netPaise = line.grossPaise - fee - tax
    plantedClass[line.lineId] = 'FEE_DRIFT'
  }

  // PARTIAL_REFUND and CHARGEBACK: negative lines riding inside a payout, so
  // the credit is smaller than the gross payments imply. An engine that sums
  // only positive lines will miss every batch that carries one.
  /** A payout a few cycles after the one that carried the original payment. */
  const laterKey = (baseLineId: string, ahead: number): string => {
    const from = keyIndex.get(batchKeyOf.get(baseLineId)!) ?? 0
    return paymentKeys[Math.min(from + ahead, paymentKeys.length - 1)]
  }

  let extraLineNo = settlements.length
  const refundTargets = rng.sample(settlements.length, orderCounts.PARTIAL_REFUND)
  for (const i of refundTargets) {
    const base = settlements[i]
    const amount = Math.round(base.grossPaise * (0.2 + rng.float() * 0.5))
    // Refunds ride in a later payout, reducing what that payout pays out.
    const key = laterKey(base.lineId, rng.int(1, 4))
    const line: SettlementLine = {
      lineId: `STL-${pad(++extraLineNo, 5)}`,
      settlementId: '',
      paymentRef: base.paymentRef,
      type: 'refund',
      grossPaise: -amount,
      feePaise: 0,
      taxPaise: 0,
      netPaise: -amount,
      settledOn: key.split('#')[0],
      utr: '',
    }
    settlements.push(line)
    batchKeyOf.set(line.lineId, key)
    plantedClass[line.lineId] = 'PARTIAL_REFUND'
    const order = orders.find((o) => o.paymentRef === base.paymentRef)
    if (order) order.status = 'partially_refunded'
  }

  const chargebackTargets = rng.sample(settlements.length, orderCounts.CHARGEBACK)
  for (const i of chargebackTargets) {
    const base = settlements[i]
    if (base.type !== 'payment') continue
    const fee = 50_000 // flat ₹500 chargeback handling fee
    const key = laterKey(base.lineId, rng.int(2, 6))
    const line: SettlementLine = {
      lineId: `STL-${pad(++extraLineNo, 5)}`,
      settlementId: '',
      paymentRef: base.paymentRef,
      type: 'chargeback',
      grossPaise: -base.grossPaise,
      feePaise: fee,
      taxPaise: 0,
      netPaise: -base.grossPaise - fee,
      settledOn: key.split('#')[0],
      utr: '',
    }
    settlements.push(line)
    batchKeyOf.set(line.lineId, key)
    plantedClass[line.lineId] = 'CHARGEBACK'
  }

  // DUPLICATE_CAPTURE: a second order carrying a payment reference that was
  // already used. Only one of the two was really paid, and the settlement
  // report has exactly one line for it — so a naive reference join happily
  // matches both and reports 100%.
  let dupNo = orders.length
  for (const i of rng.sample(orders.length, orderCounts.DUPLICATE_CAPTURE)) {
    const original = orders[i]
    const clone: Order = {
      ...original,
      orderId: `ORD-${pad(++dupNo, 5)}`,
      // A double-submit minutes later, so it lands on the same day.
      capturedOn: original.capturedOn,
    }
    orders.push(clone)
    byOrderId.set(clone.orderId, clone)
    plantedClass[clone.orderId] = 'DUPLICATE_CAPTURE'
    // Deliberately no l1 pair and no settlement line: nothing should match it.
  }

  // ── Phase D — form payout batches ─────────────────────────────────────────
  const grouped = new Map<string, SettlementLine[]>()
  for (const line of settlements) {
    const key = batchKeyOf.get(line.lineId)!
    const list = grouped.get(key) ?? []
    list.push(line)
    grouped.set(key, list)
  }

  /**
   * Carry-forward, exactly as a gateway does it. A cycle whose reversals exceed
   * its payments does not become a debit on the merchant's account — it nets
   * to nothing and the shortfall is recovered from the next payout. Modelling
   * that here keeps every batch a real, positive credit.
   */
  const orderedKeys = [...grouped.keys()].sort()
  for (let i = 0; i < orderedKeys.length; i++) {
    const lines = grouped.get(orderedKeys[i])!
    const net = lines.reduce((sum, l) => sum + l.netPaise, 0)
    if (net > 0) continue

    const nextKey = orderedKeys[i + 1]
    if (!nextKey) {
      // Nothing to carry into: fold backwards instead so no line is lost.
      const prevKey = orderedKeys[i - 1]
      if (prevKey) {
        grouped.get(prevKey)!.push(...lines)
        grouped.delete(orderedKeys[i])
      }
      continue
    }
    grouped.get(nextKey)!.unshift(...lines)
    grouped.delete(orderedKeys[i])
  }

  const batchList = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, lines], i) => {
      const settlementId = `SET-${pad(i + 1, 4)}`
      const utr = `UTR${pad(rng.int(0, 999999999999), 12)}`
      const day = key.split('#')[0]
      let netPaise = 0
      for (const line of lines) {
        line.settlementId = settlementId
        line.utr = utr
        // A line's settled date is the payout it was actually paid in.
        line.settledOn = day
        netPaise += line.netPaise
      }
      return { day, settlementId, utr, netPaise }
    })

  // ── Phase E — bank credits, one per batch ─────────────────────────────────
  const drafts: DraftBankLine[] = []

  for (const batch of batchList) {
    drafts.push({
      valueDate: batch.day,
      narration: `NEFT CR RAZORPAY SOFTWARE PVT LTD ${batch.utr} SETTLEMENT`,
      creditPaise: batch.netPaise,
      debitPaise: 0,
      truthSettlementId: batch.settlementId,
      plantedClass: null,
    })
  }

  // Ordinary business activity. Debits never compete with settlement credits,
  // but an engine that scans the whole statement has to ignore them, and a demo
  // statement made only of payouts quietly skips that test.
  for (const day of tradingDays) {
    if (rng.float() < 0.35) {
      drafts.push({
        valueDate: day,
        narration: rng.pick(VENDOR_DEBITS),
        creditPaise: 0,
        debitPaise: rng.int(5_000, 480_000) * 100,
        truthSettlementId: null,
        plantedClass: null,
      })
    }
  }

  // ── Phase F — exceptions that happen between gateway and bank ─────────────
  // Scaled off the number of payouts, which is the population these classes
  // can actually occur in — not the order count, which is ~4× larger.
  const batchCounts = countsFor(BATCH_LEVEL_RATIO, batchList.length, cfg.plant)
  const settlementDrafts = () => drafts.filter((d) => d.truthSettlementId !== null)

  // TIMING_GAP: the credit lands later than the settlement date implies. Most
  // are planted inside the tolerance window; a couple are pushed deliberately
  // outside it, so recall is genuinely below 100% and the scorecard has to
  // explain why rather than round up.
  {
    const pool = settlementDrafts()
    const picks = rng.sample(pool.length, batchCounts.TIMING_GAP)
    picks.forEach((idx, n) => {
      const d = pool[idx]
      const outsideWindow = n < Math.max(1, Math.floor(picks.length * 0.2))
      const gap = outsideWindow ? rng.int(6, 9) : rng.int(1, 2)
      d.valueDate = addBusinessDays(d.valueDate, gap)
      d.plantedClass = 'TIMING_GAP'
    })
  }

  // ROUNDING: per-line rounding leaves the batch total and the credit a few
  // paise apart. Small enough to forgive, large enough to break equality.
  {
    const pool = settlementDrafts().filter((d) => d.plantedClass === null)
    for (const idx of rng.sample(pool.length, batchCounts.ROUNDING)) {
      const d = pool[idx]
      d.creditPaise += rng.int(1, 240) * (rng.float() < 0.5 ? -1 : 1)
      d.plantedClass = 'ROUNDING'
    }
  }

  // NARRATION_NOISE: the reference survives the export, but not intact.
  {
    const pool = settlementDrafts().filter((d) => d.plantedClass === null)
    for (const idx of rng.sample(pool.length, batchCounts.NARRATION_NOISE)) {
      const d = pool[idx]
      const utr = d.narration.match(/UTR\d+/)?.[0]
      if (!utr) continue
      d.narration = d.narration.replace(utr, mangleUtr(utr, rng))
      d.plantedClass = 'NARRATION_NOISE'
    }
  }

  // SPLIT_PAYOUT: one batch arrives as two credits. No single credit equals the
  // batch total, so amount matching has to consider sums of candidates.
  {
    const pool = settlementDrafts().filter((d) => d.plantedClass === null)
    for (const idx of rng.sample(pool.length, batchCounts.SPLIT_PAYOUT)) {
      const d = pool[idx]
      const legOne = Math.round(d.creditPaise * (0.4 + rng.float() * 0.2))
      const legTwo = d.creditPaise - legOne
      d.creditPaise = legOne
      d.plantedClass = 'SPLIT_PAYOUT'
      drafts.push({
        valueDate: rng.float() < 0.5 ? d.valueDate : addBusinessDays(d.valueDate, 1),
        // The trailing leg arrives without the reference. This is what banks
        // actually do on a split remittance, and it is what makes the class
        // hard: the first leg alone does not satisfy the batch, the second leg
        // cannot be tied to it by reference, and neither is close enough on
        // amount to match on its own. Only summing them works.
        narration: d.narration.replace(/UTR\d+/, 'REF NOT PROVIDED'),
        creditPaise: legTwo,
        debitPaise: 0,
        truthSettlementId: d.truthSettlementId,
        plantedClass: 'SPLIT_PAYOUT',
      })
    }
  }

  // MISSING_CREDIT: the gateway reported a payout the bank never received.
  // Removing the credit is the whole point — the engine must surface the
  // settlement as unmatched rather than quietly leaving it off the report.
  const missingSettlementIds: string[] = []
  {
    const pool = settlementDrafts().filter((d) => d.plantedClass === null)
    const picks = new Set(rng.sample(pool.length, batchCounts.MISSING_CREDIT).map((i) => pool[i]))
    for (const d of picks) {
      missingSettlementIds.push(d.truthSettlementId!)
      plantedClass[d.truthSettlementId!] = 'MISSING_CREDIT'
    }
    for (let i = drafts.length - 1; i >= 0; i--) {
      if (picks.has(drafts[i])) drafts.splice(i, 1)
    }
  }

  // ORPHAN_CREDIT: money in from somewhere else entirely. Never matchable —
  // an engine that forces every credit onto some settlement will produce
  // exactly these as false positives.
  for (let i = 0; i < batchCounts.ORPHAN_CREDIT; i++) {
    // Half are obvious — a landlord deposit, an insurance claim, nothing that
    // resembles a payout. The other half are decoys: a credit from a second
    // gateway, on the same day as a real settlement, sized within a couple of
    // percent of it.
    //
    // The decoys are the only records here that can *cost* the engine
    // precision, and they are the reason the false-positive count is worth
    // printing. A matcher that treats "close on amount, same day" as sufficient
    // will take the bait; the reckless tolerance profile exists to show it
    // doing exactly that.
    const decoy = i % 2 === 1 && batchList.length > 0
    if (decoy) {
      const target = batchList[rng.int(0, batchList.length - 1)]
      const drift = 1 + (rng.float() * 0.03 - 0.015) // ±1.5%
      drafts.push({
        valueDate: target.day,
        narration: `NEFT CR PAYU PAYMENTS PVT LTD ${pad(rng.int(0, 999999), 6)} PAYOUT`,
        creditPaise: Math.max(1, Math.round(target.netPaise * drift)),
        debitPaise: 0,
        truthSettlementId: null,
        plantedClass: 'ORPHAN_CREDIT',
      })
      continue
    }
    drafts.push({
      valueDate: rng.pick(tradingDays),
      narration: rng.pick(ORPHAN_NARRATIONS),
      creditPaise: rng.int(2_000, 90_000) * 100,
      debitPaise: 0,
      truthSettlementId: null,
      plantedClass: 'ORPHAN_CREDIT',
    })
  }

  // REFERENCE LOSS — hard mode. Runs last so it cannot starve the pools the
  // other classes draw from; whatever payouts are still clean are fair game.
  if (cfg.referenceLoss > 0) {
    const pool = settlementDrafts().filter((d) => d.plantedClass === null)
    const wanted = Math.round(settlementDrafts().length * cfg.referenceLoss)

    for (const idx of rng.sample(pool.length, Math.min(wanted, pool.length))) {
      const d = pool[idx]
      d.narration = d.narration.replace(/UTR\d+/, 'REF NOT PROVIDED')
      d.plantedClass = 'NARRATION_NOISE'

      // Losing the reference alone is not enough to defeat the rules: the
      // amount still matches exactly and tier 2 picks it up on amount+date.
      // Pushing it past the window as well is what removes the last
      // deterministic handle and forces a judgement call.
      if (rng.float() < 0.65) {
        d.valueDate = addBusinessDays(d.valueDate, rng.int(4, 7))
      }

      // A plausible impostor for the credit we just made hard to identify:
      // same day, similar size, and a narration naming a different gateway.
      // Rejecting this is the adjudicator's most valuable output, and the
      // engine has nothing numeric left to reject it with.
      if (rng.float() < 0.5) {
        drafts.push({
          valueDate: d.valueDate,
          narration: `NEFT CR PAYU PAYMENTS PVT LTD ${pad(rng.int(0, 999999), 6)} PAYOUT`,
          creditPaise: Math.max(1, Math.round(d.creditPaise * (1 + (rng.float() * 0.04 - 0.02)))),
          debitPaise: 0,
          truthSettlementId: null,
          plantedClass: 'ORPHAN_CREDIT',
        })
      }
    }
  }

  // ── Phase G — date, number and balance the statement ──────────────────────
  drafts.sort(
    (a, b) =>
      a.valueDate.localeCompare(b.valueDate) ||
      b.creditPaise - a.creditPaise ||
      a.narration.localeCompare(b.narration),
  )

  let balance = 25_00_000_00 // ₹25L opening
  const bankLines: BankLine[] = drafts.map((d, i) => {
    const lineId = `BNK-${pad(i + 1, 5)}`
    d.lineId = lineId
    balance += d.creditPaise - d.debitPaise
    if (d.plantedClass) plantedClass[lineId] = d.plantedClass
    return {
      lineId,
      valueDate: d.valueDate,
      narration: d.narration,
      creditPaise: d.creditPaise,
      debitPaise: d.debitPaise,
      balancePaise: balance,
    }
  })

  // ── Phase H — ground truth ────────────────────────────────────────────────
  const l2Pairs: [string, string][] = drafts
    .filter((d) => d.truthSettlementId !== null)
    .map((d) => [d.truthSettlementId!, d.lineId!] as [string, string])

  const truth: GroundTruth = { l1Pairs, l2Pairs, plantedClass }

  settlements.sort((a, b) => a.settledOn.localeCompare(b.settledOn) || a.lineId.localeCompare(b.lineId))
  orders.sort((a, b) => a.capturedOn.localeCompare(b.capturedOn) || a.orderId.localeCompare(b.orderId))

  return {
    orders,
    settlements,
    bankLines,
    truth,
    meta: {
      seed: cfg.seed,
      orderCount: cfg.orderCount,
      startDay: cfg.startDay,
      days: cfg.days,
      generatedAt: new Date().toISOString(),
    },
  }
}

/** Counts per planted class, for the Data Studio and the scorecard. */
export function plantedSummary(truth: GroundTruth): Record<string, number> {
  const out: Record<string, number> = {}
  for (const code of Object.values(truth.plantedClass)) {
    out[code] = (out[code] ?? 0) + 1
  }
  return out
}
