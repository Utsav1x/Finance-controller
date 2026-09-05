import { TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/app/page-header'
import { EmptyState } from '@/components/recon/empty-state'
import { ExceptionQueue } from '@/components/recon/exception-queue'
import { getRun, latestRun } from '@/lib/db/queries'

export const dynamic = 'force-dynamic'

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; run?: string }>
}) {
  const { focus, run: runParam } = await searchParams
  const summary = runParam ? { id: runParam } : latestRun()
  const run = summary ? getRun(summary.id) : null

  if (!run) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Exceptions"
          title="Nothing to review yet"
          description="The exception queue is populated by a run. Reconcile a batch and whatever the engine could not resolve will appear here."
        />
        <EmptyState
          icon={TriangleAlert}
          title="No run to review"
          body="Every unresolved record arrives here with its reason code, the amount at risk, and the candidates the engine rejected — with why it rejected them."
          action={{ href: '/run', label: 'Reconcile a batch' }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`From ${run.label}`}
        title="Exception queue"
        description="What the engine would not guess at. Each item carries the reason, the money exposed, and the candidates it considered — so a reviewer can disagree with the reasoning rather than just the outcome."
      />
      <ExceptionQueue runId={run.id} initial={run.exceptions} focus={focus} />
    </div>
  )
}
