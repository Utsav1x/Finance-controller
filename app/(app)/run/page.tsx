'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  CircleDashed,
  Loader2,
  Play,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/app/page-header'
import { TierBar } from '@/components/recon/tier-bar'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/format-date'
import type { RunMetrics } from '@/lib/recon/metrics'
import type { ProgressEvent } from '@/lib/recon/engine'

interface RunResponse {
  runId: string
  label: string
  metrics: RunMetrics
  timeline: ProgressEvent[]
  adjudicator: string | null
  exceptionCount: number
  matchCount: number
}

const PRESETS = [
  { label: '50 orders', orderCount: 50, days: 10, note: "the track's floor" },
  { label: '220 orders', orderCount: 220, days: 20, note: 'default' },
  { label: '500 orders', orderCount: 500, days: 30, note: 'throughput' },
  { label: '2,000 orders', orderCount: 2000, days: 60, note: 'stress' },
]

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

const inputClass =
  'amount h-9 w-full rounded-lg border border-border bg-card/60 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20'

export default function RunConsolePage() {
  const [orderCount, setOrderCount] = useState(220)
  const [days, setDays] = useState(20)
  const [seed, setSeed] = useState(42)
  const [settlementsPerDay, setSettlementsPerDay] = useState(3)
  const [useAdjudicator, setUseAdjudicator] = useState(true)

  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResponse | null>(null)
  const [revealed, setRevealed] = useState(0)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  async function start() {
    setRunning(true)
    setError(null)
    setResult(null)
    setRevealed(0)
    timers.current.forEach(clearTimeout)
    timers.current = []

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderCount, seed, settlementsPerDay, days, useAdjudicator }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'the run failed')

      setResult(data as RunResponse)

      // The engine finishes in milliseconds, so the stages are revealed on a
      // fixed cadence to be readable. The elapsed figure against each one is
      // the real measurement, not the reveal delay — a progress bar that
      // invented latency to look busy would be lying about the only number
      // this page exists to demonstrate.
      ;(data as RunResponse).timeline.forEach((_, i) => {
        timers.current.push(setTimeout(() => setRevealed(i + 1), 180 * (i + 1)))
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const m = result?.metrics

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Run console"
        title="Reconcile a batch"
        description="Generate three synthetic sources from a seed and run the full pipeline over them. Same seed, same data, same result — every time."
        actions={
          <Button
            size="lg"
            onClick={start}
            disabled={running}
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? 'Reconciling…' : 'Run reconciliation'}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Configuration ─────────────────────────────────────────────── */}
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col gap-5 p-5">
            <div>
              <h2 className="text-sm font-semibold">Batch</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setOrderCount(p.orderCount)
                      setDays(p.days)
                    }}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                      orderCount === p.orderCount
                        ? 'border-primary/40 bg-primary/15 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    title={p.note}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Orders">
                <input
                  type="number"
                  className={inputClass}
                  value={orderCount}
                  min={10}
                  max={5000}
                  onChange={(e) => setOrderCount(Number(e.target.value))}
                />
              </Field>
              <Field label="Seed" hint="Reproduces the batch exactly">
                <input
                  type="number"
                  className={inputClass}
                  value={seed}
                  min={0}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
              </Field>
              <Field label="Days">
                <input
                  type="number"
                  className={inputClass}
                  value={days}
                  min={5}
                  max={90}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </Field>
              <Field label="Payouts / day" hint="Cycles the gateway settles in">
                <input
                  type="number"
                  className={inputClass}
                  value={settlementsPerDay}
                  min={1}
                  max={8}
                  onChange={(e) => setSettlementsPerDay(Number(e.target.value))}
                />
              </Field>
            </div>

            <button
              type="button"
              onClick={() => setUseAdjudicator((v) => !v)}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                useAdjudicator
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-border hover:bg-muted/50',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border',
                  useAdjudicator
                    ? 'border-accent/50 bg-accent/20 text-accent'
                    : 'border-border text-transparent',
                )}
              >
                <Check className="size-3" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-3.5 text-accent" />
                  Tier-4 adjudication
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Sends only what the rules could not resolve to a model. Without an API key this
                  is a no-op and those records go to the exception list — the run still completes
                  and is still graded.
                </span>
              </span>
            </button>
          </CardContent>
        </Card>

        {/* ── Pipeline ──────────────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Pipeline</h2>
              {m && (
                <span className="amount text-xs text-muted-foreground">
                  {m.throughput.records} records · {formatDuration(m.throughput.wallMs)} ·{' '}
                  {m.throughput.recordsPerSecond.toLocaleString('en-IN')}/s
                </span>
              )}
            </div>

            {!result && !running && !error && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Configure the batch and run it. Each stage reports what it resolved and how long it
                had taken by that point.
              </p>
            )}

            {running && (
              <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Generating sources and reconciling…
              </div>
            )}

            {error && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {result && (
              <ol className="mt-4 flex flex-col">
                {result.timeline.map((event, i) => {
                  const shown = i < revealed
                  return (
                    <li
                      key={`${event.stage}-${i}`}
                      className={cn(
                        'flex items-start gap-3 border-l border-border py-2.5 pl-4 transition-all duration-500',
                        shown ? 'opacity-100' : 'translate-y-1 opacity-0',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full',
                          event.stage === 'done'
                            ? 'bg-success/20 text-success'
                            : 'bg-primary/20 text-primary',
                        )}
                      >
                        {shown ? <Check className="size-2.5" /> : <CircleDashed className="size-2.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-medium">{event.label}</p>
                          <span className="amount text-xs text-muted-foreground">
                            {event.elapsedMs}ms
                          </span>
                        </div>
                        {event.detail && (
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {event.detail}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Result ──────────────────────────────────────────────────────── */}
      {m && result && (
        <section className="grid gap-4 lg:grid-cols-4">
          {[
            {
              label: 'Auto-matched',
              value: `${(m.resolution.autoMatchRate * 100).toFixed(1)}%`,
              note: `${m.resolution.autoMatched} of ${m.resolution.totalPairs}`,
              tone: 'text-success',
            },
            {
              label: 'Precision',
              value: `${(m.overall.precision * 100).toFixed(1)}%`,
              note: `${m.resolution.falsePositives} false positive${m.resolution.falsePositives === 1 ? '' : 's'}`,
              tone: m.resolution.falsePositives === 0 ? 'text-success' : 'text-destructive',
            },
            {
              label: 'Recall',
              value: `${(m.overall.recall * 100).toFixed(1)}%`,
              note: `${m.resolution.missed} missed`,
              tone: 'text-accent',
            },
            {
              label: 'Exceptions',
              value: String(result.exceptionCount),
              note: 'reported, not dropped',
              tone: 'text-warning',
            },
          ].map((tile) => (
            <Card key={tile.label}>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{tile.label}</p>
                <p className={cn('amount mt-2 text-2xl font-semibold', tile.tone)}>{tile.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{tile.note}</p>
              </CardContent>
            </Card>
          ))}

          <Card className="lg:col-span-3">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold">Which tier did the work</h3>
              <div className="mt-4">
                <TierBar breakdown={m.tierBreakdown} />
              </div>
              {!result.adjudicator && (
                <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  No adjudicator ran — either no key is configured or the deterministic tiers
                  resolved everything. Both are reported the same way and neither is hidden.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex h-full flex-col justify-between gap-4 p-5">
              <div>
                <Badge variant="success">Run saved</Badge>
                <p className="amount mt-3 text-xs text-muted-foreground">{result.runId}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Link
                  href={`/runs/${result.runId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-foreground"
                >
                  Open the workspace <ArrowRight className="size-3.5" />
                </Link>
                <Link
                  href="/scorecard"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Read the scorecard <ArrowRight className="size-3.5" />
                </Link>
                <Link
                  href="/exceptions"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Work the exception queue <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}
