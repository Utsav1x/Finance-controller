import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveException } from '@/lib/db/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ResolveSchema = z.object({
  runId: z.string().min(1),
  exceptionId: z.string().min(1),
  resolution: z.enum(['open', 'accepted', 'rejected', 'reassigned']),
  note: z.string().max(500).optional(),
})

export async function PATCH(request: Request) {
  const parsed = ResolveSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad request' }, { status: 400 })
  }

  const { runId, exceptionId, resolution, note } = parsed.data
  resolveException(runId, exceptionId, resolution, note)

  return NextResponse.json({ ok: true, exceptionId, resolution })
}
