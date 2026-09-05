/**
 * "Ask the Ledger" — natural language over a completed run.
 *
 * This is not retrieval over prose. The model never sees a document and is
 * never asked to do arithmetic; it chooses which of a fixed set of typed
 * queries to run, we execute those against the run's own records, and it writes
 * the answer from the rows that come back.
 *
 * The reason is narrow and important. A finance answer is only useful if it can
 * be checked, and an answer assembled from retrieved text cannot be — it will
 * happily state a total that appears nowhere. Here every figure in an answer
 * came out of a query, and every record it names can be opened. When the tools
 * return nothing, the honest answer is "the run does not contain that", and the
 * prompt says so.
 */

import { z } from 'zod'
import type { StoredRun } from '@/lib/db/queries'
import { getAIProvider } from './providers'
import { formatMoney } from '@/lib/format-money'
import { buildBatches } from '@/lib/recon/normalize'
import { reasonCode } from '@/lib/recon/reason-codes'

// ─── Tools ───────────────────────────────────────────────────────────────────

const PlanSchema = z.object({
  queries: z
    .array(
      z.object({
        tool: z.string(),
        arg: z.string().default(''),
      }),
    )
    .max(4),
})

const TOOL_MENU = `run_summary()              headline metrics: match rate, precision, recall, exception counts
shortfall(settlementId)    why one payout is smaller than its gross: fees, GST, refunds, chargebacks, line by line
batch_detail(settlementId) one payout: its lines, its net, and the bank credit it matched to
bank_line_detail(lineId)   one statement line and what it was matched to
payouts_on(YYYY-MM-DD)     every payout settled on a date, with the credits that discharged them
exceptions(code)           unresolved items; pass a reason code to filter, or "" for all
fee_drift()                every payment where the fee deducted differed from the contracted rate
variance_summary()         totals by variance type across the whole run`

export interface ToolResult {
  tool: string
  arg: string
  rows: unknown
}

/** Executed locally. The model picks which to call; it never supplies the numbers. */
export function runTool(run: StoredRun, tool: string, arg: string): ToolResult {
  const batches = buildBatches(run.dataset.settlements)
  const batchById = new Map(batches.map((b) => [b.settlementId, b]))
  const creditById = new Map(run.dataset.bankLines.map((l) => [l.lineId, l]))
  const m = run.metrics

  const matchesFor = (id: string) =>
    run.matches.filter((x) => x.leftId === id || x.rightId === id)

  switch (tool) {
    case 'run_summary':
      return {
        tool,
        arg,
        rows: {
          label: run.label,
          seed: run.seed,
          records: m.throughput.records,
          wallMs: m.throughput.wallMs,
          autoMatchRate: `${(m.resolution.autoMatchRate * 100).toFixed(1)}%`,
          toReview: m.resolution.review,
          precision: `${(m.overall.precision * 100).toFixed(1)}%`,
          recall: `${(m.overall.recall * 100).toFixed(1)}%`,
          falsePositives: m.resolution.falsePositives,
          openExceptions: run.exceptions.filter((e) => e.resolution === 'open').length,
          exceptionsByCode: m.exceptionsByCode,
          valueAtRisk: formatMoney(m.unmatchedValuePaise),
          varianceFound: formatMoney(m.varianceValuePaise),
        },
      }

    case 'shortfall': {
      const batch = batchById.get(arg)
      if (!batch) return { tool, arg, rows: { error: `no settlement ${arg} in this run` } }

      const payments = batch.lines.filter((l) => l.type === 'payment')
      const refunds = batch.lines.filter((l) => l.type === 'refund')
      const chargebacks = batch.lines.filter((l) => l.type === 'chargeback')
      const gross = payments.reduce((s, l) => s + l.grossPaise, 0)
      const fees = batch.lines.reduce((s, l) => s + l.feePaise, 0)
      const tax = batch.lines.reduce((s, l) => s + l.taxPaise, 0)

      return {
        tool,
        arg,
        rows: {
          settlementId: batch.settlementId,
          settledOn: batch.settledOn,
          utr: batch.utr,
          grossPayments: formatMoney(gross),
          gatewayFees: formatMoney(-fees),
          gstOnFees: formatMoney(-tax),
          refunds: formatMoney(refunds.reduce((s, l) => s + l.netPaise, 0)),
          chargebacks: formatMoney(chargebacks.reduce((s, l) => s + l.netPaise, 0)),
          netPaidOut: formatMoney(batch.netPaise),
          refundLines: refunds.map((l) => ({
            lineId: l.lineId,
            paymentRef: l.paymentRef,
            amount: formatMoney(l.netPaise),
          })),
          chargebackLines: chargebacks.map((l) => ({
            lineId: l.lineId,
            paymentRef: l.paymentRef,
            amount: formatMoney(l.netPaise),
          })),
          paymentCount: payments.length,
        },
      }
    }

    case 'batch_detail': {
      const batch = batchById.get(arg)
      if (!batch) return { tool, arg, rows: { error: `no settlement ${arg} in this run` } }
      const matched = matchesFor(arg)
      return {
        tool,
        arg,
        rows: {
          settlementId: batch.settlementId,
          settledOn: batch.settledOn,
          utr: batch.utr,
          net: formatMoney(batch.netPaise),
          lineCount: batch.lines.length,
          matchedTo: matched.map((x) => ({
            bankLine: x.rightId,
            tier: x.tier,
            state: x.state,
            variance: x.varianceCode,
            variancePaise: x.variancePaise,
            narration: creditById.get(x.rightId)?.narration,
          })),
          exception: run.exceptions.find((e) => e.recordId === arg) ?? null,
        },
      }
    }

    case 'bank_line_detail': {
      const line = creditById.get(arg)
      if (!line) return { tool, arg, rows: { error: `no bank line ${arg} in this run` } }
      return {
        tool,
        arg,
        rows: {
          ...line,
          credit: formatMoney(line.creditPaise),
          debit: formatMoney(line.debitPaise),
          matchedTo: matchesFor(arg).map((x) => ({ settlement: x.leftId, tier: x.tier, state: x.state })),
          exception: run.exceptions.find((e) => e.recordId === arg) ?? null,
        },
      }
    }

    case 'payouts_on': {
      const onDay = batches.filter((b) => b.settledOn === arg)
      return {
        tool,
        arg,
        rows: onDay.map((b) => ({
          settlementId: b.settlementId,
          utr: b.utr,
          net: formatMoney(b.netPaise),
          lines: b.lines.length,
          matchedTo: matchesFor(b.settlementId).map((x) => x.rightId),
        })),
      }
    }

    case 'exceptions': {
      const open = run.exceptions.filter(
        (e) => e.resolution === 'open' && (arg === '' || e.code === arg),
      )
      return {
        tool,
        arg,
        rows: open.slice(0, 25).map((e) => ({
          recordId: e.recordId,
          code: e.code,
          meaning: reasonCode(e.code).description,
          amount: formatMoney(e.amountPaise),
          occurredOn: e.occurredOn,
          rationale: e.rationale,
        })),
      }
    }

    case 'fee_drift': {
      const drifted = run.matches.filter((x) => x.varianceCode === 'FEE_DRIFT')
      return {
        tool,
        arg,
        rows: {
          count: drifted.length,
          totalOvercharged: formatMoney(drifted.reduce((s, x) => s + Math.abs(x.variancePaise), 0)),
          contractedFeeBps: run.tolerances.feeBps,
          sample: drifted.slice(0, 12).map((x) => ({
            order: x.leftId,
            settlementLine: x.rightId,
            extraDeducted: formatMoney(Math.abs(x.variancePaise)),
          })),
        },
      }
    }

    case 'variance_summary': {
      const totals: Record<string, { count: number; paise: number }> = {}
      for (const x of run.matches) {
        if (!x.varianceCode) continue
        const bucket = (totals[x.varianceCode] ??= { count: 0, paise: 0 })
        bucket.count++
        bucket.paise += Math.abs(x.variancePaise)
      }
      return {
        tool,
        arg,
        rows: Object.entries(totals).map(([code, v]) => ({
          code,
          meaning: reasonCode(code).label,
          count: v.count,
          value: formatMoney(v.paise),
        })),
      }
    }

    default:
      return { tool, arg, rows: { error: `unknown tool "${tool}"` } }
  }
}

// ─── The agent ───────────────────────────────────────────────────────────────

export interface Answer {
  answer: string
  toolsUsed: { tool: string; arg: string }[]
  citations: string[]
  usage: { calls: number; inputTokens: number; outputTokens: number }
}

const PLAN_SYSTEM = `You plan which queries to run against one completed payment-reconciliation run. You do not answer the question yourself.

Available tools:
${TOOL_MENU}

Return ONLY JSON: {"queries":[{"tool":"shortfall","arg":"SET-0012"}]}

Pick at most 4. Prefer the most specific tool that can answer the question. When the user names a payout by date rather than id, call payouts_on first — a later step can then look up the id it returns. When nothing more specific fits, call run_summary.`

const ANSWER_SYSTEM = `You answer questions about one payment-reconciliation run for the merchant's finance team.

You are given the exact rows returned by the queries that were run. Every figure in your answer must come from those rows. Do not estimate, do not extrapolate, and do not perform arithmetic beyond adding figures that are explicitly present.

Cite the records you relied on inline in square brackets, e.g. [SET-0012], [BNK-00043], [ORD-00117]. Cite them where the claim is made, not in a list at the end.

If the rows do not contain what was asked, say plainly that this run does not contain it and name what would answer it. Never fill a gap with a plausible number — a wrong figure in a reconciliation answer is worse than no answer, because someone will act on it.

Be brief: two to five sentences, plain English, no preamble. Amounts in the ₹1,23,456.78 format already used in the rows.`

export async function askLedger(run: StoredRun, question: string): Promise<Answer> {
  const provider = getAIProvider()
  if (!provider) {
    throw new Error(
      'No AI provider configured. Set GOOGLE_AI_API_KEY in .env.local to use Ask the Ledger — the reconciliation engine itself does not need it.',
    )
  }

  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 }

  // ── 1. Plan ───────────────────────────────────────────────────────────────
  const { data: planData, usage: planUsage } = await provider.generateJSON<unknown>(
    PLAN_SYSTEM,
    question,
    { temperature: 0, maxTokens: 512 },
  )
  usage.calls += planUsage.calls
  usage.inputTokens += planUsage.inputTokens
  usage.outputTokens += planUsage.outputTokens

  const plan = PlanSchema.safeParse(planData)
  const queries = plan.success && plan.data.queries.length > 0
    ? plan.data.queries
    : [{ tool: 'run_summary', arg: '' }]

  // ── 2. Execute, locally ───────────────────────────────────────────────────
  const results = queries.map((q) => runTool(run, q.tool, q.arg))

  // A date query that returned payouts is usually a prelude to asking about
  // one of them, so the detail is fetched now rather than costing another turn.
  const firstPayouts = results.find((r) => r.tool === 'payouts_on')
  if (firstPayouts && Array.isArray(firstPayouts.rows) && firstPayouts.rows.length > 0) {
    const first = firstPayouts.rows[0] as { settlementId?: string }
    if (first.settlementId && !results.some((r) => r.arg === first.settlementId)) {
      results.push(runTool(run, 'shortfall', first.settlementId))
    }
  }

  // ── 3. Answer, from the rows only ─────────────────────────────────────────
  const context = results
    .map((r) => `QUERY ${r.tool}(${r.arg})\n${JSON.stringify(r.rows, null, 2)}`)
    .join('\n\n')

  const { text, usage: answerUsage } = await provider.generateText(
    ANSWER_SYSTEM,
    `Question: ${question}\n\nRows returned:\n\n${context}`,
    { temperature: 0.1, maxTokens: 700 },
  )
  usage.calls += answerUsage.calls
  usage.inputTokens += answerUsage.inputTokens
  usage.outputTokens += answerUsage.outputTokens

  return {
    answer: text.trim(),
    toolsUsed: results.map((r) => ({ tool: r.tool, arg: r.arg })),
    citations: [...new Set(text.match(/\[([A-Z]{3}-[0-9]+)\]/g) ?? [])].map((c) =>
      c.replace(/[[\]]/g, ''),
    ),
    usage,
  }
}

export { TOOL_MENU }
