import { getRun, latestRun } from '@/lib/db/queries'
import { buildBatches } from '@/lib/recon/normalize'
import { toRupees } from '@/lib/format-money'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function csv(header: string[], body: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header.join(','), ...body.map((row) => row.map(escape).join(','))].join('\n')
}

/**
 * Exports.
 *
 * `journal` is the one that matters to a controller. A reconciliation that ends
 * at "these records match" has not finished the job — somebody still has to
 * post the fee, the GST on it, the refunds and the chargebacks to the right
 * accounts. Only batches that actually reconciled are included: proposing a
 * journal entry for a payout the bank never received would put unproven money
 * into the books, which is precisely the error the exception list exists to
 * prevent.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const kind = params.get('kind') ?? 'journal'
  const runId = params.get('runId') ?? latestRun()?.id

  if (!runId) return new Response('no runs yet', { status: 404 })
  const run = getRun(runId)
  if (!run) return new Response('run not found', { status: 404 })

  let content: string
  let filename: string

  switch (kind) {
    case 'orders':
      content = csv(
        ['order_id', 'customer', 'gross_inr', 'currency', 'captured_on', 'payment_ref', 'status'],
        run.dataset.orders.map((o) => [
          o.orderId, o.customer, toRupees(o.grossPaise), o.currency, o.capturedOn, o.paymentRef ?? '', o.status,
        ]),
      )
      filename = `orders-${runId}.csv`
      break

    case 'settlements':
      content = csv(
        ['line_id', 'settlement_id', 'payment_ref', 'type', 'gross_inr', 'fee_inr', 'tax_inr', 'net_inr', 'settled_on', 'utr'],
        run.dataset.settlements.map((s) => [
          s.lineId, s.settlementId, s.paymentRef, s.type,
          toRupees(s.grossPaise), toRupees(s.feePaise), toRupees(s.taxPaise), toRupees(s.netPaise),
          s.settledOn, s.utr,
        ]),
      )
      filename = `settlements-${runId}.csv`
      break

    case 'bank':
      content = csv(
        ['line_id', 'value_date', 'narration', 'credit_inr', 'debit_inr', 'balance_inr'],
        run.dataset.bankLines.map((l) => [
          l.lineId, l.valueDate, l.narration,
          toRupees(l.creditPaise), toRupees(l.debitPaise), toRupees(l.balancePaise),
        ]),
      )
      filename = `bank-statement-${runId}.csv`
      break

    case 'exceptions':
      content = csv(
        ['exception_id', 'record_id', 'record_kind', 'code', 'amount_inr', 'occurred_on', 'resolution', 'rationale'],
        run.exceptions.map((e) => [
          e.exceptionId, e.recordId, e.recordKind, e.code,
          toRupees(e.amountPaise), e.occurredOn, e.resolution, e.rationale ?? '',
        ]),
      )
      filename = `exceptions-${runId}.csv`
      break

    case 'matches':
      content = csv(
        ['match_id', 'level', 'left_id', 'right_id', 'tier', 'confidence', 'state', 'variance_code', 'variance_inr'],
        run.matches.map((m) => [
          m.matchId, m.level, m.leftId, m.rightId, m.tier, m.confidence, m.state,
          m.varianceCode ?? '', toRupees(m.variancePaise),
        ]),
      )
      filename = `matches-${runId}.csv`
      break

    case 'journal': {
      const batches = buildBatches(run.dataset.settlements)
      const reconciled = new Set(
        run.matches.filter((m) => m.level === 'L2' && m.state !== 'exception').map((m) => m.leftId),
      )
      const body: (string | number)[][] = []

      for (const batch of batches) {
        if (!reconciled.has(batch.settlementId)) continue

        const payments = batch.lines.filter((l) => l.type === 'payment')
        const grossPayments = payments.reduce((s, l) => s + l.grossPaise, 0)
        const fees = batch.lines.reduce((s, l) => s + l.feePaise, 0)
        const tax = batch.lines.reduce((s, l) => s + l.taxPaise, 0)
        const refunds = batch.lines.filter((l) => l.type === 'refund').reduce((s, l) => s + l.netPaise, 0)
        const chargebacks = batch.lines
          .filter((l) => l.type === 'chargeback')
          .reduce((s, l) => s + l.netPaise, 0)

        const push = (account: string, dr: number, cr: number, memo: string) => {
          if (dr === 0 && cr === 0) return
          body.push([
            batch.settledOn, batch.settlementId, batch.utr, account,
            dr === 0 ? '' : toRupees(dr), cr === 0 ? '' : toRupees(cr), memo,
          ])
        }

        push('Bank — current account', batch.netPaise, 0, `Settlement ${batch.settlementId}`)
        push('Gateway commission', fees, 0, `${batch.lines.length} lines`)
        push('GST input credit', tax, 0, 'GST on gateway commission')
        push('Refunds to customers', Math.abs(refunds), 0, `${batch.lines.filter((l) => l.type === 'refund').length} refund(s)`)
        push('Chargebacks — disputed', Math.abs(chargebacks), 0, `${batch.lines.filter((l) => l.type === 'chargeback').length} chargeback(s)`)
        push('Payment gateway clearing', 0, grossPayments, `${payments.length} payment(s) settled`)
      }

      content = csv(
        ['date', 'settlement_id', 'utr', 'account', 'debit_inr', 'credit_inr', 'memo'],
        body,
      )
      filename = `journal-${runId}.csv`
      break
    }

    default:
      return new Response(`unknown export "${kind}"`, { status: 400 })
  }

  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
