import Link from 'next/link'
import {
  ArrowRight,
  BadgeIndianRupee,
  CircleAlert,
  Clock,
  Crosshair,
  Layers,
  Play,
  Target,
  TriangleAlert,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { LinkButton } from '@/components/ui/link-button'
import { PageHeader } from '@/components/app/page-header'
import { StatTile } from '@/components/recon/stat-tile'
import { TierBar } from '@/components/recon/tier-bar'
import { ReasonBadge } from '@/components/recon/state-badge'
import { Money } from '@/components/recon/money'
import { EmptyState } from '@/components/recon/empty-state'
import { getRun, listRuns } from '@/lib/db/queries'
import { formatDuration, formatDay, formatRelative } from '@/lib/format-date'
import { reasonCode, SEVERITY_ORDER } from '@/lib/recon/reason-codes'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const runs = listRuns(6)
  const latest = runs[0] ? getRun(runs[0].id) : null

  if (!latest) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Overview"
          title="Nothing reconciled yet"
          description="Generate a batch of synthetic order, settlement and bank records, then reconcile it. Everything runs locally and needs no API key."
        />
        <EmptyState
          icon={Play}
          title="Run your first reconciliation"
          body="A default batch is 220 orders across 20 days, carrying all ten planted exception classes. The run finishes in milliseconds and is graded against ground truth."
          action={{ href: '/run', label: 'Reconcile a batch' }}
        />
      </div>
    )
  }

  const m = latest.metrics
  const open = latest.exceptions.filter((e) => e.resolution === 'open')
  const topExceptions = [...open]
    .sort(
      (a, b) =>
        SEVERITY_ORDER[reasonCode(a.code).severity] - SEVERITY_ORDER[reasonCode(b.code).severity] ||
        b.amountPaise - a.amountPaise,
    )
    .slice(0, 6)

  const reconciledPaise = latest.matches
    .filter((x) => x.level === 'L2' && x.state !== 'exception')
    .reduce((sum, x) => {
      const line = latest.dataset.bankLines.find((l) => l.lineId === x.rightId)
      return sum + (line?.creditPaise ?? 0)
    }, 0)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`Last run ${formatRelative(latest.createdAt)}`}
        title={latest.label}
        description={`${m.throughput.records} records across three sources, reconciled in ${formatDuration(m.throughput.wallMs)} and graded against ground truth.`}
        actions={
          <LinkButton
            href="/run"
            size="lg"
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            <Play className="size-4" />
            New run
          </LinkButton>
        }
      />

      <section aria-label="Headline metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Target}
          label="Auto-matched"
          value={`${(m.resolution.autoMatchRate * 100).toFixed(1)}%`}
          note={`${m.resolution.autoMatched} of ${m.resolution.totalPairs} pairs, no human needed`}
          tone="good"
        />
        <StatTile
          icon={Crosshair}
          label="Precision"
          value={`${(m.overall.precision * 100).toFixed(1)}%`}
          note={
            m.resolution.falsePositives === 0
              ? 'no false positives'
              : `${m.resolution.falsePositives} false positive${m.resolution.falsePositives === 1 ? '' : 's'}`
          }
          tone={m.resolution.falsePositives === 0 ? 'good' : 'bad'}
        />
        <StatTile
          icon={TriangleAlert}
          label="Open exceptions"
          value={String(open.length)}
          note={`${(m.unmatchedValuePaise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })} at risk`}
          tone={open.length === 0 ? 'good' : 'warn'}
        />
        <StatTile
          icon={Clock}
          label="Throughput"
          value={`${m.throughput.recordsPerSecond.toLocaleString('en-IN')}/s`}
          note={`${m.throughput.records} records in ${formatDuration(m.throughput.wallMs)}`}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-label="Exception queue" className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <TriangleAlert className="size-5 text-warning" />
              Needs a human
            </h2>
            <Link
              href="/exceptions"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Full queue
              <ArrowRight className="size-4" />
            </Link>
          </div>

          {topExceptions.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Nothing unresolved. Every record in this batch was accounted for.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col divide-y divide-border/60 p-0">
                {topExceptions.map((e) => (
                  <Link
                    key={e.exceptionId}
                    href={`/exceptions?focus=${e.exceptionId}`}
                    className="flex items-start gap-3 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ReasonBadge code={e.code} />
                        <span className="amount text-xs text-muted-foreground">{e.recordId}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDay(e.occurredOn)}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                        {e.rationale ?? reasonCode(e.code).description}
                      </p>
                    </div>
                    <Money paise={e.amountPaise} className="shrink-0 text-sm font-medium" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </section>

        <section aria-label="Run detail" className="flex flex-col gap-6">
          <Card>
            <CardContent className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="size-4 text-primary" />
                Which tier did the work
              </h3>
              <div className="mt-4">
                <TierBar breakdown={m.tierBreakdown} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <BadgeIndianRupee className="size-4 text-success" />
                Cash accounted for
              </h3>
              <p className="amount mt-3 text-2xl font-semibold">
                <Money paise={reconciledPaise} compact />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                reconciled to the bank statement
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CircleAlert className="size-3.5 text-warning" />
                  Variance found
                </span>
                <Money paise={m.varianceValuePaise} className="font-medium text-warning" />
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {runs.length > 1 && (
        <section aria-label="Recent runs">
          <h2 className="mb-4 text-lg font-semibold">Recent runs</h2>
          <Card>
            <CardContent className="flex flex-col divide-y divide-border/60 p-0">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.label}</span>
                  <span className="amount text-sm text-success">
                    {(r.autoMatchRate * 100).toFixed(1)}%
                  </span>
                  <span className="amount text-sm text-muted-foreground">
                    P {(r.metrics.overall.precision * 100).toFixed(1)}%
                  </span>
                  <span className="amount text-sm text-warning">{r.openExceptions} open</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelative(r.createdAt)}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}
