import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateDataset } from '@/lib/data/generator'
import { reconcile } from '@/lib/recon/engine'
import { createAdjudicator } from '@/lib/ai/adjudicator'
import { mergeTolerances } from '@/lib/recon/tolerances'
import { getTolerances, listRuns, saveRun } from '@/lib/db/queries'

// node:sqlite and the engine are server-side only.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const StartSchema = z.object({
  orderCount: z.number().int().min(10).max(5000).default(220),
  seed: z.number().int().min(0).max(2_147_483_647).default(42),
  settlementsPerDay: z.number().int().min(1).max(8).default(3),
  days: z.number().int().min(5).max(90).default(20),
  /** Hard mode: fraction of payouts stripped of their reference and delayed past the window. */
  referenceLoss: z.number().min(0).max(0.9).default(0),
  label: z.string().max(80).optional(),
  useAdjudicator: z.boolean().default(true),
  tolerances: z.record(z.string(), z.number()).optional(),
})

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 25)
  return NextResponse.json({ runs: listRuns(Math.min(Math.max(limit, 1), 100)) })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = StartSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad request' }, { status: 400 })
  }
  const input = parsed.data

  const dataset = generateDataset({
    seed: input.seed,
    orderCount: input.orderCount,
    settlementsPerDay: input.settlementsPerDay,
    days: input.days,
    referenceLoss: input.referenceLoss,
  })

  // Saved rules are the baseline; anything sent with the request overrides them
  // for this run only, so experimenting on the Run Console cannot quietly
  // change the profile every later run is graded under.
  const tolerances = mergeTolerances({ ...getTolerances(), ...(input.tolerances ?? {}) })

  const adjudicator = input.useAdjudicator ? createAdjudicator() : null

  const result = await reconcile(dataset, { tolerances, adjudicator })

  const label =
    input.label?.trim() ||
    [
      `${input.orderCount} orders`,
      `seed ${input.seed}`,
      input.referenceLoss > 0 ? `${Math.round(input.referenceLoss * 100)}% ref loss` : null,
      adjudicator ? null : 'rules only',
    ]
      .filter(Boolean)
      .join(' · ')

  saveRun(result, dataset, label)

  return NextResponse.json({
    runId: result.runId,
    label,
    metrics: result.metrics,
    timeline: result.timeline,
    tolerances: result.tolerances,
    adjudicator: result.adjudicatorName,
    exceptionCount: result.exceptions.length,
    matchCount: result.matches.length,
  })
}
