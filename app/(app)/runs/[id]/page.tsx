import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Clock, Crosshair, Layers, Target, TriangleAlert } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/app/page-header'
import { StatTile } from '@/components/recon/stat-tile'
import { Workspace, type WorkspaceRow } from '@/components/recon/workspace'
import { getRun } from '@/lib/db/queries'
import { buildBatches } from '@/lib/recon/normalize'
import { formatDuration, formatRelative } from '@/lib/format-date'
import { formatMoney } from '@/lib/format-money'

export const dynamic = 'force-dynamic'

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const run = getRun(id)
  if (!run) notFound()

  const m = run.metrics
  const batches = new Map(buildBatches(run.dataset.settlements).map((b) => [b.settlementId, b]))
  const orders = new Map(run.dataset.orders.map((o) => [o.orderId, o]))
  const lines = new Map(run.dataset.settlements.map((s) => [s.lineId, s]))
  const bank = new Map(run.dataset.bankLines.map((l) => [l.lineId, l]))

  // ── Matches ───────────────────────────────────────────────────────────────
  const rows: WorkspaceRow[] = run.matches.map((match) => {
    if (match.level === 'L2') {
      const batch = batches.get(match.leftId)
      const credit = bank.get(match.rightId)
      return {
        id: match.matchId,
        level: 'L2',
        state: match.state,
        tier: match.tier,
        confidence: match.confidence,
        leftLabel: match.leftId,
        leftDetail: batch
          ? `${batch.lines.length} lines · ${batch.utr} · settled ${batch.settledOn}`
          : 'settlement not in this run',
        leftPaise: batch?.netPaise ?? 0,
        rightLabel: match.rightId,
        rightDetail: credit?.narration ?? 'bank line not in this run',
        rightPaise: credit?.creditPaise ?? 0,
        day: batch?.settledOn ?? credit?.valueDate ?? '',
        varianceCode: match.varianceCode,
        variancePaise: match.variancePaise,
        rationale: match.rationale,
        evidence: match.evidence,
      }
    }

    const order = orders.get(match.leftId)
    const line = lines.get(match.rightId)
    return {
      id: match.matchId,
      level: 'L1',
      state: match.state,
      tier: match.tier,
      confidence: match.confidence,
      leftLabel: match.leftId,
      leftDetail: order ? `${order.customer} · ${order.paymentRef}` : 'order not in this run',
      leftPaise: order?.grossPaise ?? 0,
      rightLabel: match.rightId,
      rightDetail: line
        ? `${line.settlementId} · fee ${formatMoney(line.feePaise + line.taxPaise)}`
        : 'settlement line not in this run',
      rightPaise: line?.netPaise ?? 0,
      day: order?.capturedOn ?? '',
      varianceCode: match.varianceCode,
      variancePaise: match.variancePaise,
      rationale: match.rationale,
      evidence: match.evidence,
    }
  })

  // ── Exceptions, rendered in the same list so nothing is hidden by a tab ───
  for (const e of run.exceptions) {
    rows.push({
      id: e.exceptionId,
      level: e.level,
      state: 'exception',
      tier: 0,
      confidence: 0,
      leftLabel: e.recordId,
      leftDetail: e.rationale ?? e.code,
      leftPaise: e.amountPaise,
      rightLabel: e.rejected.length > 0 ? `${e.rejected.length} candidate(s) rejected` : 'no candidate',
      rightDetail: e.rejected.map((c) => `${c.candidateId} (${c.reason})`).join(' · ') || '—',
      rightPaise: 0,
      day: e.occurredOn,
      varianceCode: e.code,
      variancePaise: 0,
      rationale: null,
      evidence: e.rejected.map((c) => ({
        field: `rejected ${c.candidateId}`,
        left: c.reason,
        right: `Δ${c.deltaPaise} paise · ${c.dayGap} day gap · score ${c.score}`,
        agrees: false,
        deltaPaise: c.deltaPaise,
      })),
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`Run ${formatRelative(run.createdAt)} · seed ${run.seed}`}
        title={run.label}
        description={`${run.dataset.orders.length} orders · ${run.dataset.settlements.length} settlement lines · ${run.dataset.bankLines.length} bank lines, reconciled in ${formatDuration(m.throughput.wallMs)}.`}
        actions={
          <Link
            href="/scorecard"
            className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-foreground"
          >
            Scorecard <ArrowRight className="size-4" />
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Target}
          label="Auto-matched"
          value={`${(m.resolution.autoMatchRate * 100).toFixed(1)}%`}
          note={`${m.resolution.review} sent to review`}
          tone="good"
        />
        <StatTile
          icon={Crosshair}
          label="Precision / recall"
          value={`${(m.overall.precision * 100).toFixed(1)} / ${(m.overall.recall * 100).toFixed(1)}%`}
          note={`${m.resolution.falsePositives} FP · ${m.resolution.missed} missed`}
          tone={m.resolution.falsePositives === 0 ? 'good' : 'bad'}
        />
        <StatTile
          icon={TriangleAlert}
          label="Exceptions"
          value={String(run.exceptions.length)}
          note={`${formatMoney(m.unmatchedValuePaise)} at risk`}
          tone="warn"
        />
        <StatTile
          icon={Clock}
          label="Throughput"
          value={`${m.throughput.recordsPerSecond.toLocaleString('en-IN')}/s`}
          note={
            m.throughput.llmCalls > 0
              ? `${m.throughput.llmCalls} model call(s) · $${m.throughput.estCostUsd.toFixed(5)}`
              : 'no model calls needed'
          }
        />
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Layers className="size-5 text-primary" />
          Reconciliation workspace
        </h2>
        <Workspace rows={rows} />
      </section>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold">Timeline</h3>
          <ol className="mt-3 flex flex-col divide-y divide-border/60">
            {run.timeline.map((event, i) => (
              <li key={`${event.stage}-${i}`} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
                <span className="amount w-16 shrink-0 text-xs text-muted-foreground">
                  {event.elapsedMs}ms
                </span>
                <div className="min-w-0">
                  <p className="text-sm">{event.label}</p>
                  {event.detail && (
                    <p className="text-xs text-muted-foreground">{event.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
