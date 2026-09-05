/**
 * Tier 1 — identifier equality.
 *
 * This is where a naive matcher stops, and it is also where a naive matcher
 * quietly starts lying. Two cases make identifier equality insufficient on real
 * data, and both are handled here rather than deferred:
 *
 *   - **More orders than lines for one reference.** A double capture means the
 *     same reference sits on two orders while the gateway settled one. Matching
 *     both is how a matcher reports 100% while the merchant is out a refund.
 *
 *   - **A correct match that is still wrong about the money.** When the fee
 *     deducted is not the fee contracted, the reference matches perfectly and
 *     the cash is still short. That is reported as a variance on the match, not
 *     buried by it.
 */

import type { EvidenceItem, Match, Order, ReconException, SettlementLine } from './types'
import type { Tolerances } from './tolerances'
import { deltaBps } from '@/lib/format-money'

export function evidence(
  field: string,
  left: string,
  right: string,
  agrees: boolean,
  deltaPaise?: number,
): EvidenceItem {
  return { field, left, right, agrees, deltaPaise }
}

export interface L1Result {
  matches: Match[]
  exceptions: ReconException[]
  unmatchedLineIds: string[]
}

/**
 * Order ledger ↔ gateway payment lines.
 *
 * Refunds and chargebacks carry a payment reference too, but they are not
 * settlements *of* an order — they are reversals riding in the same payout.
 * Including them here would double-count every refunded order, so only
 * `type === 'payment'` lines participate.
 */
export function matchL1(
  orders: Order[],
  settlements: SettlementLine[],
  t: Tolerances,
): L1Result {
  const matches: Match[] = []
  const exceptions: ReconException[] = []

  const paymentLines = settlements.filter((s) => s.type === 'payment')

  const linesByRef = new Map<string, SettlementLine[]>()
  for (const line of paymentLines) {
    const list = linesByRef.get(line.paymentRef) ?? []
    list.push(line)
    linesByRef.set(line.paymentRef, list)
  }

  const ordersByRef = new Map<string, Order[]>()
  for (const order of orders) {
    if (!order.paymentRef) continue
    const list = ordersByRef.get(order.paymentRef) ?? []
    list.push(order)
    ordersByRef.set(order.paymentRef, list)
  }

  const consumedLines = new Set<string>()

  for (const [ref, group] of ordersByRef) {
    const lines = (linesByRef.get(ref) ?? []).slice().sort((a, b) => a.lineId.localeCompare(b.lineId))

    // First capture wins. Both orders are identical apart from their id, so the
    // tie has to break on something defensible: the earliest one is the one the
    // customer actually completed, the later is the double-submit.
    const claimants = group
      .slice()
      .sort((a, b) => a.capturedOn.localeCompare(b.capturedOn) || a.orderId.localeCompare(b.orderId))

    const pairable = Math.min(claimants.length, lines.length)

    for (let i = 0; i < pairable; i++) {
      const order = claimants[i]
      const line = lines[i]
      consumedLines.add(line.lineId)

      const expectedFee = Math.round((order.grossPaise * t.feeBps) / 10_000)
      const expectedTax = Math.round(expectedFee * t.feeTaxRate)
      const expectedDeduction = expectedFee + expectedTax
      const actualDeduction = line.feePaise + line.taxPaise
      const feeVariance = actualDeduction - expectedDeduction
      const feeDrifted =
        deltaBps(order.grossPaise + feeVariance, order.grossPaise) > t.feeDriftBps &&
        feeVariance !== 0

      const grossAgrees = order.grossPaise === line.grossPaise

      const ev: EvidenceItem[] = [
        evidence('payment reference', ref, line.paymentRef, true),
        evidence(
          'gross amount',
          String(order.grossPaise),
          String(line.grossPaise),
          grossAgrees,
          line.grossPaise - order.grossPaise,
        ),
        evidence(
          'fee + tax',
          `expected ${expectedDeduction}`,
          `deducted ${actualDeduction}`,
          !feeDrifted,
          feeVariance,
        ),
        evidence('captured / settled', order.capturedOn, line.settledOn, true),
      ]

      matches.push({
        matchId: `L1-${order.orderId}`,
        level: 'L1',
        leftId: order.orderId,
        rightId: line.lineId,
        tier: 1,
        confidence: 1,
        // The pairing is certain; the money is not. Sending it to review is the
        // point — someone has to decide whether to chase the difference.
        state: feeDrifted ? 'review' : 'matched',
        evidence: ev,
        varianceCode: feeDrifted ? 'FEE_DRIFT' : null,
        variancePaise: feeDrifted ? -feeVariance : 0,
        rationale: null,
      })
    }

    // Orders left holding a reference that was already settled once.
    for (let i = pairable; i < claimants.length; i++) {
      const order = claimants[i]
      exceptions.push({
        exceptionId: `EXC-${order.orderId}`,
        level: 'L1',
        recordId: order.orderId,
        recordKind: 'order',
        code: 'DUPLICATE_CAPTURE',
        amountPaise: order.grossPaise,
        occurredOn: order.capturedOn,
        rejected: lines.map((line) => ({
          candidateId: line.lineId,
          reason: `already settled against ${claimants[lines.indexOf(line)]?.orderId ?? 'an earlier order'}`,
          deltaPaise: 0,
          dayGap: 0,
          score: 0,
        })),
        rationale: `Payment reference ${ref} appears on ${claimants.length} orders but the gateway settled ${lines.length}.`,
        resolution: 'open',
      })
    }
  }

  // Orders whose reference the gateway never reported at all.
  for (const order of orders) {
    if (!order.paymentRef) continue
    if (matches.some((m) => m.leftId === order.orderId)) continue
    if (exceptions.some((e) => e.recordId === order.orderId)) continue

    exceptions.push({
      exceptionId: `EXC-${order.orderId}`,
      level: 'L1',
      recordId: order.orderId,
      recordKind: 'order',
      code: 'NO_CANDIDATE',
      amountPaise: order.grossPaise,
      occurredOn: order.capturedOn,
      rejected: [],
      rationale: `No settlement line carries payment reference ${order.paymentRef}.`,
      resolution: 'open',
    })
  }

  return {
    matches,
    exceptions,
    unmatchedLineIds: paymentLines.filter((l) => !consumedLines.has(l.lineId)).map((l) => l.lineId),
  }
}
