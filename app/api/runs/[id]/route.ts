import { NextResponse } from 'next/server'
import { deleteRun, getAgentLog, getRun } from '@/lib/db/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const run = getRun(id)
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 })

  return NextResponse.json({ run, agentLog: getAgentLog(id) })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  deleteRun(id)
  return NextResponse.json({ ok: true })
}
