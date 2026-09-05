import { BadgeIndianRupee, TrendingUp, TriangleAlert, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/app/page-header'
import { StatTile } from '@/components/recon/stat-tile'
import { EmptyState } from '@/components/recon/empty-state'
import { Money } from '@/components/recon/money'
import { getRun, latestRun } from '@/lib/db/queries'
import { buildBatches } from '@/lib/recon/normalize'
import { addDays, formatDayShort } from '@/lib/format-date'
import { formatCompact, formatMoney } from '@/lib/format-money'

export const dynamic = 'force-dynamic'

const HORIZON_WEEKS = 13

export default async function CashPage() {
  const summary = latestRun()
  const run = summary ? getRun(summary.id) : null

  if (!run) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Cash position"
          title="No position to report"
          description="The forward view is built only from reconciled records, so it needs a completed run."
        />
        <EmptyState
          icon={Wallet}
          title="Reconcile first"
          body="Projecting from unreconciled data means projecting from money you have not proved arrived. Run a reconciliation and this page will build the position from what actually landed."
          action={{ href: '/run', label: 'Reconcile a batch' }}
        />
      </div>
    )
  }

  const lines = [...run.dataset.bankLines].sort((a, b) => a.valueDate.localeCompare(b.valueDate))
  const closing = lines.at(-1)?.balancePaise ?? 0
  const lastDay = lines.at(-1)?.valueDate ?? run.dataset.meta.startDay

  // ── What is actually reconciled ───────────────────────────────────────────
  const matchedCreditIds = new Set(
    run.matches.filter((x) => x.level === 'L2' && x.state !== 'exception').map((x) => x.rightId),
  )
  const reconciledIn = lines
    .filter((l) => matchedCreditIds.has(l.lineId))
    .reduce((sum, l) => sum + l.creditPaise, 0)
  const totalOut = lines.reduce((sum, l) => sum + l.debitPaise, 0)

  const openExceptions = run.exceptions.filter((e) => e.resolution === 'open')
  const atRisk = openExceptions.reduce((sum, e) => sum + Math.abs(e.amountPaise), 0)

  // Settlements the gateway reported that never reached the bank. This is money
  // the merchant is owed and has not been paid — it belongs in the pipeline,
  // not in the balance.
  const batches = buildBatches(run.dataset.settlements)
  const missing = openExceptions.filter((e) => e.code === 'MISSING_CREDIT')
  const missingIds = new Set(missing.map((e) => e.recordId))
  const pipeline = batches
    .filter((b) => missingIds.has(b.settlementId))
    .reduce((sum, b) => sum + b.netPaise, 0)

  // ── Weekly history, and a projection built from it ────────────────────────
  const weekly = new Map<string, number>()
  for (const line of lines) {
    // Bucket by ISO-ish week start so the series is evenly spaced.
    const day = new Date(`${line.valueDate}T00:00:00Z`)
    const offset = (day.getUTCDay() + 6) % 7
    const weekStart = addDays(line.valueDate, -offset)
    weekly.set(weekStart, (weekly.get(weekStart) ?? 0) + line.creditPaise - line.debitPaise)
  }
  const history = [...weekly.entries()].sort(([a], [b]) => a.localeCompare(b))
  const netByWeek = history.map(([, net]) => net)
  const meanWeekly = netByWeek.length
    ? netByWeek.reduce((a, b) => a + b, 0) / netByWeek.length
    : 0
  const variance = netByWeek.length
    ? netByWeek.reduce((sum, n) => sum + (n - meanWeekly) ** 2, 0) / netByWeek.length
    : 0
  const stdev = Math.sqrt(variance)

  // The band widens with the square root of the horizon, and is floored by
  // unreconciled exposure — money whose arrival is not proven should not
  // narrow a forecast.
  const projection = Array.from({ length: HORIZON_WEEKS }, (_, i) => {
    const week = i + 1
    const central = closing + meanWeekly * week
    const spread = stdev * Math.sqrt(week) + atRisk * 0.5
    return {
      weekStart: addDays(lastDay, week * 7),
      central,
      low: central - spread,
      high: central + spread,
    }
  })

  const allValues = [
    ...history.map(([, n]) => closing),
    ...projection.flatMap((p) => [p.low, p.high]),
    closing,
  ]
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const span = max - min || 1
  const y = (value: number) => 100 - ((value - min) / span) * 100

  const points = projection.map((p, i) => ({
    x: (i / (HORIZON_WEEKS - 1)) * 100,
    ...p,
  }))
  const centralPath = points.map((p) => `${p.x},${y(p.central)}`).join(' ')
  const bandPath = `${points.map((p) => `${p.x},${y(p.high)}`).join(' ')} ${points
    .slice()
    .reverse()
    .map((p) => `${p.x},${y(p.low)}`)
    .join(' ')}`

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`From ${run.label}`}
        title="Cash position"
        description="Built only from records that reconciled. Money the gateway says it sent but the bank never received sits in the pipeline, not in the balance."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Wallet}
          label="Closing balance"
          value={formatCompact(closing)}
          note={`as at ${formatDayShort(lastDay)}`}
        />
        <StatTile
          icon={BadgeIndianRupee}
          label="Reconciled inflow"
          value={formatCompact(reconciledIn)}
          note="proved against the statement"
          tone="good"
        />
        <StatTile
          icon={TrendingUp}
          label="Owed, not received"
          value={formatCompact(pipeline)}
          note={`${missing.length} payout${missing.length === 1 ? '' : 's'} never landed`}
          tone={pipeline > 0 ? 'bad' : 'neutral'}
        />
        <StatTile
          icon={TriangleAlert}
          label="Unreconciled exposure"
          value={formatCompact(atRisk)}
          note={`${openExceptions.length} open exception${openExceptions.length === 1 ? '' : 's'}`}
          tone={atRisk > 0 ? 'warn' : 'good'}
        />
      </section>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{HORIZON_WEEKS}-week forward position</h2>
            <span className="amount text-xs text-muted-foreground">
              mean weekly net {formatMoney(Math.round(meanWeekly))} · σ {formatMoney(Math.round(stdev))}
            </span>
          </div>

          <div className="mt-5 overflow-x-auto">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="h-56 w-full min-w-[520px]"
              role="img"
              aria-label={`Projected cash balance over ${HORIZON_WEEKS} weeks with a confidence band`}
            >
              <polygon points={bandPath} className="fill-accent/15" />
              <polyline
                points={centralPath}
                className="fill-none stroke-primary"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0"
                y1={y(closing)}
                x2="100"
                y2={y(closing)}
                className="stroke-border"
                strokeWidth="0.5"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>

          <div className="mt-2 flex justify-between text-[0.65rem] text-muted-foreground">
            <span className="amount">{formatDayShort(points[0].weekStart)}</span>
            <span className="amount">{formatDayShort(points.at(-1)!.weekStart)}</span>
          </div>

          <div className="mt-5 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
            {[
              { label: 'In 4 weeks', p: points[3] },
              { label: 'In 8 weeks', p: points[7] },
              { label: `In ${HORIZON_WEEKS} weeks`, p: points.at(-1)! },
            ].map(({ label, p }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="amount mt-1 text-lg font-semibold">{formatCompact(p.central)}</p>
                <p className="amount mt-0.5 text-xs text-muted-foreground">
                  {formatCompact(p.low)} – {formatCompact(p.high)}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
            This is a straight-line extrapolation of the observed weekly net, not a model. The band
            is one standard deviation widening with the square root of the horizon, floored by
            unreconciled exposure — because a forecast should not get more confident while the
            amount of unproven money grows. Reconcile more and the band narrows.
          </p>
        </CardContent>
      </Card>

      {missing.length > 0 && (
        <Card className="border-destructive/25 bg-destructive/5">
          <CardContent className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <TriangleAlert className="size-4 text-destructive" />
              Payouts the bank never received
            </h3>
            <ul className="mt-3 flex flex-col divide-y divide-border/60">
              {missing.map((e) => (
                <li key={e.exceptionId} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <span className="amount text-sm">{e.recordId}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      settled {formatDayShort(e.occurredOn)}
                    </span>
                  </div>
                  <Money paise={e.amountPaise} className="text-sm font-medium text-destructive" />
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              Chase these with the gateway quoting the UTR, and carry them as a receivable until
              they land. They are excluded from the balance above.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total credits in statement', value: lines.reduce((s, l) => s + l.creditPaise, 0) },
          { label: 'Total debits in statement', value: -totalOut },
          { label: 'Variance recovered by matching', value: run.metrics.varianceValuePaise },
        ].map((t) => (
          <Card key={t.label}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{t.label}</p>
              <p className="amount mt-2 text-lg font-semibold">
                <Money paise={t.value} />
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
