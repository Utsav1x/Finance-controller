import Link from 'next/link'
import { Check, Gauge, Sigma, TriangleAlert, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/app/page-header'
import { TierBar } from '@/components/recon/tier-bar'
import { EmptyState } from '@/components/recon/empty-state'
import { getRun, latestRun, listRuns } from '@/lib/db/queries'
import { formatDuration, formatRelative } from '@/lib/format-date'
import { formatMoney } from '@/lib/format-money'
import { reasonCode } from '@/lib/recon/reason-codes'
import { cn } from '@/lib/utils'
import type { LevelMetrics } from '@/lib/recon/metrics'

export const dynamic = 'force-dynamic'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function LevelRow({ label, note, m }: { label: string; note: string; m: LevelMetrics }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="p-4">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      </td>
      <td className="amount p-4 text-success">{pct(m.precision)}</td>
      <td className="amount p-4 text-accent">{pct(m.recall)}</td>
      <td className="amount p-4">{m.f1.toFixed(3)}</td>
      <td className="amount p-4 text-muted-foreground">{m.truePositives}</td>
      <td className={cn('amount p-4', m.falsePositives > 0 ? 'text-destructive' : 'text-muted-foreground')}>
        {m.falsePositives}
      </td>
      <td className={cn('amount p-4', m.falseNegatives > 0 ? 'text-warning' : 'text-muted-foreground')}>
        {m.falseNegatives}
      </td>
    </tr>
  )
}

export default async function ScorecardPage() {
  const summary = latestRun()
  const run = summary ? getRun(summary.id) : null
  const history = listRuns(10)

  if (!run) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Scorecard"
          title="Nothing measured yet"
          description="The scorecard grades a run against the ground truth the generator wrote before the engine saw any of it."
        />
        <EmptyState
          icon={Gauge}
          title="No run to grade"
          body="Reconcile a batch and this page will report precision, recall, false positives, per-class recall and throughput — the numbers that decide whether the match rate means anything."
          action={{ href: '/run', label: 'Reconcile a batch' }}
        />
      </div>
    )
  }

  const m = run.metrics
  const classes = Object.entries(m.plantedRecall)
    .filter(([, s]) => s.planted > 0)
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`${run.label} · ${formatRelative(run.createdAt)}`}
        title="Scorecard"
        description="Graded against ground truth written as the data was generated, before the engine saw any of it. Reproduce any figure here with the seed and the tolerance profile below."
        actions={
          <Badge variant={m.resolution.falsePositives === 0 ? 'success' : 'destructive'}>
            {m.resolution.falsePositives} false positive
            {m.resolution.falsePositives === 1 ? '' : 's'}
          </Badge>
        }
      />

      {/* ── Accuracy ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Accuracy</h2>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="p-4 font-medium">Level</th>
                    <th className="p-4 font-medium">Precision</th>
                    <th className="p-4 font-medium">Recall</th>
                    <th className="p-4 font-medium">F1</th>
                    <th className="p-4 font-medium">TP</th>
                    <th className="p-4 font-medium">FP</th>
                    <th className="p-4 font-medium">FN</th>
                  </tr>
                </thead>
                <tbody>
                  <LevelRow label="L1" note="orders → gateway payment lines" m={m.l1} />
                  <LevelRow label="L2" note="payout batches → bank credits" m={m.l2} />
                  <LevelRow label="Overall" note="every asserted pair" m={m.overall} />
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Resolution and tiers ────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sigma className="size-4 text-primary" />
              Where every true pair ended up
            </h3>
            <ul className="mt-4 flex flex-col divide-y divide-border/60">
              {[
                { label: 'Auto-matched, no human needed', value: m.resolution.autoMatched, tone: 'text-success' },
                { label: 'Matched, sent to review', value: m.resolution.review, tone: 'text-warning' },
                { label: 'Missed entirely', value: m.resolution.missed, tone: 'text-destructive' },
              ].map((r) => (
                <li key={r.label} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <span className="text-sm text-muted-foreground">{r.label}</span>
                  <span className="flex items-baseline gap-2">
                    <span className={cn('amount font-semibold', r.tone)}>{r.value}</span>
                    <span className="amount text-xs text-muted-foreground">
                      {pct(m.resolution.totalPairs === 0 ? 0 : r.value / m.resolution.totalPairs)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
              Auto-matched is the number worth quoting. Review means the engine found the right
              record and still wants a human to look — a fee that moved, a payout that arrived
              late, a split it had to infer.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Gauge className="size-4 text-accent" />
              Which tier did the work
            </h3>
            <div className="mt-4">
              <TierBar breakdown={m.tierBreakdown} />
            </div>
            <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
              If tier 4 carries almost nothing, the rules are doing the job and the model is a
              garnish. If it carries almost everything, the match rate is a model&apos;s opinion.
              Both readings matter and neither is visible from a match rate.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Planted-class recall ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Per-class recall</h2>
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Ten failure modes were planted deliberately. The bar differs by class, because the
          correct outcome differs: a mangled narration should still reconcile, while a payout that
          never landed should produce an exception naming it — matching it would be a failure
          dressed as a success.
        </p>
        <Card>
          <CardContent className="grid gap-x-8 gap-y-1 p-5 sm:grid-cols-2">
            {classes.map(([code, stat]) => {
              const complete = stat.handled === stat.planted
              return (
                <div
                  key={code}
                  className="flex items-center gap-3 border-b border-border/40 py-2.5 last:border-0"
                >
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full',
                      complete ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
                    )}
                  >
                    {complete ? <Check className="size-3" /> : <X className="size-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{reasonCode(code).label}</p>
                  </div>
                  <span className="amount shrink-0 text-sm text-muted-foreground">
                    {stat.handled}/{stat.planted}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </section>

      {/* ── Throughput ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Throughput and cost</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Records', value: m.throughput.records.toLocaleString('en-IN') },
            { label: 'Wall clock', value: formatDuration(m.throughput.wallMs) },
            { label: 'Records / second', value: m.throughput.recordsPerSecond.toLocaleString('en-IN') },
            {
              label: 'Model calls',
              value:
                m.throughput.llmCalls === 0
                  ? 'none'
                  : `${m.throughput.llmCalls} · $${m.throughput.estCostUsd.toFixed(5)}`,
            },
          ].map((t) => (
            <Card key={t.label}>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{t.label}</p>
                <p className="amount mt-2 text-xl font-semibold">{t.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Comparison ──────────────────────────────────────────────────── */}
      {history.length > 1 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Run over run</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="p-4 font-medium">Run</th>
                      <th className="p-4 font-medium">Auto</th>
                      <th className="p-4 font-medium">Precision</th>
                      <th className="p-4 font-medium">Recall</th>
                      <th className="p-4 font-medium">FP</th>
                      <th className="p-4 font-medium">Window</th>
                      <th className="p-4 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {history.map((r) => (
                      <tr key={r.id} className="transition-colors hover:bg-muted/40">
                        <td className="p-4">
                          <Link href={`/runs/${r.id}`} className="hover:text-primary">
                            {r.label}
                          </Link>
                        </td>
                        <td className="amount p-4 text-success">{pct(r.autoMatchRate)}</td>
                        <td className="amount p-4">{pct(r.metrics.overall.precision)}</td>
                        <td className="amount p-4">{pct(r.metrics.overall.recall)}</td>
                        <td
                          className={cn(
                            'amount p-4',
                            r.metrics.resolution.falsePositives > 0
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                          )}
                        >
                          {r.metrics.resolution.falsePositives}
                        </td>
                        <td className="amount p-4 text-muted-foreground">
                          {r.id === run.id ? `${run.tolerances.dateWindowDays}d` : '—'}
                        </td>
                        <td className="amount p-4 text-muted-foreground">
                          {formatDuration(r.metrics.throughput.wallMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Method ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">How these numbers are produced</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold">Ground truth, written first</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Every true relationship is recorded as the data is generated. The engine never
                reads it and only the grader touches it, so a run cannot mark its own paper.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold">Pairs, not records</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Precision and recall are computed over asserted (left, right) pairs against true
                pairs. A split payout contributes one pair per leg, so getting half of one right
                counts as exactly that.
              </p>
            </CardContent>
          </Card>
          <Card className="border-destructive/25 bg-destructive/5">
            <CardContent className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <TriangleAlert className="size-4 text-destructive" />
                How to check we are not cheating
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Set the tolerances absurdly wide on the Rules page and re-run. False positives must
                appear. If they never do, the grader is not grading and nothing on this page means
                anything.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold">Tolerance profile for this run</h3>
            <div className="amount mt-3 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(run.tolerances).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between border-b border-border/40 py-1">
                  <span className="text-muted-foreground">{key}</span>
                  <span>{String(value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-b border-border/40 py-1">
                <span className="text-muted-foreground">seed</span>
                <span>{run.seed}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/40 py-1">
                <span className="text-muted-foreground">value at risk</span>
                <span>{formatMoney(m.unmatchedValuePaise)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
