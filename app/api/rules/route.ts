import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getTolerances, saveTolerances } from '@/lib/db/queries'
import { mergeTolerances } from '@/lib/recon/tolerances'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TolerancesSchema = z.object({
  roundingPaise: z.number().min(0).max(10_000_000),
  amountBps: z.number().min(0).max(2000),
  dateWindowDays: z.number().int().min(0).max(60),
  feeBps: z.number().min(0).max(2000),
  feeTaxRate: z.number().min(0).max(1),
  feeDriftBps: z.number().min(0).max(500),
  fuzzyAcceptScore: z.number().min(0).max(1),
  llmConfidenceFloor: z.number().min(0).max(1),
  ambiguityMargin: z.number().min(0).max(1),
  maxSplitLegs: z.number().int().min(1).max(6),
  maxLlmCalls: z.number().int().min(0).max(500),
})

export async function GET() {
  return NextResponse.json({ tolerances: getTolerances() })
}

export async function PUT(request: Request) {
  const parsed = TolerancesSchema.partial().safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad request' }, { status: 400 })
  }

  const next = mergeTolerances({ ...getTolerances(), ...parsed.data })
  saveTolerances(next)

  return NextResponse.json({ tolerances: next })
}
