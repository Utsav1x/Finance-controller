import { NextResponse } from 'next/server'
import { z } from 'zod'
import { askLedger } from '@/lib/ai/qa-agent'
import { getRun, latestRun, logAgentEvent } from '@/lib/db/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AskSchema = z.object({
  question: z.string().min(3).max(500),
  runId: z.string().optional(),
})

export async function POST(request: Request) {
  const parsed = AskSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ask a question of at least three characters.' }, { status: 400 })
  }

  const runId = parsed.data.runId ?? latestRun()?.id
  if (!runId) {
    return NextResponse.json(
      { error: 'There are no runs yet. Reconcile a batch first, then ask about it.' },
      { status: 404 },
    )
  }

  const run = getRun(runId)
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 })

  try {
    const answer = await askLedger(run, parsed.data.question)
    logAgentEvent(runId, 'ask', parsed.data.question, answer.toolsUsed.map((t) => `${t.tool}(${t.arg})`).join(', '))
    return NextResponse.json({ ...answer, runId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
