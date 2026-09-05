import { NextResponse } from 'next/server'
import { generateDataset, plantedSummary } from '@/lib/data/generator'
import { buildBatches } from '@/lib/recon/normalize'
import { reasonCode } from '@/lib/recon/reason-codes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Generates a batch and reports its shape without reconciling or persisting it.
 * The Data Studio uses this so you can see what a seed will produce — including
 * exactly which failure modes are in it — before spending a run on it.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const clamp = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback

  const dataset = generateDataset({
    seed: clamp(Number(params.get('seed')), 0, 2_147_483_647, 42),
    orderCount: clamp(Number(params.get('orderCount')), 10, 5000, 220),
    days: clamp(Number(params.get('days')), 5, 90, 20),
    settlementsPerDay: clamp(Number(params.get('settlementsPerDay')), 1, 8, 3),
  })

  const batches = buildBatches(dataset.settlements)
  const planted = plantedSummary(dataset.truth)

  return NextResponse.json({
    sources: {
      orders: dataset.orders.length,
      settlementLines: dataset.settlements.length,
      bankLines: dataset.bankLines.length,
      payoutBatches: batches.length,
      records:
        dataset.orders.length + dataset.settlements.length + dataset.bankLines.length,
    },
    truth: {
      l1Pairs: dataset.truth.l1Pairs.length,
      l2Pairs: dataset.truth.l2Pairs.length,
    },
    planted: Object.entries(planted)
      .map(([code, count]) => ({
        code,
        label: reasonCode(code).label,
        severity: reasonCode(code).severity,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    meta: dataset.meta,
  })
}
