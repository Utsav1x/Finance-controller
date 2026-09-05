'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Database, Download, Loader2, Play, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/app/page-header'
import { cn } from '@/lib/utils'

interface Preview {
  sources: {
    orders: number
    settlementLines: number
    bankLines: number
    payoutBatches: number
    records: number
  }
  truth: { l1Pairs: number; l2Pairs: number }
  planted: { code: string; label: string; severity: 'high' | 'medium' | 'low'; count: number }[]
  meta: { seed: number; startDay: string; days: number }
}

const EXPORTS = [
  { kind: 'journal', label: 'Journal entries', note: 'Dr/Cr lines for reconciled payouts' },
  { kind: 'exceptions', label: 'Exceptions', note: 'the unresolved list' },
  { kind: 'matches', label: 'Matches', note: 'every asserted pair with its tier' },
  { kind: 'orders', label: 'Order ledger', note: 'source 1' },
  { kind: 'settlements', label: 'Gateway settlements', note: 'source 2' },
  { kind: 'bank', label: 'Bank statement', note: 'source 3' },
]

const SEVERITY_VARIANT = { high: 'destructive', medium: 'warning', low: 'outline' } as const

const inputClass =
  'amount h-9 w-full rounded-lg border border-border bg-card/60 px-3 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20'

export default function DataStudioPage() {
  const router = useRouter()
  const [seed, setSeed] = useState(42)
  const [orderCount, setOrderCount] = useState(220)
  const [days, setDays] = useState(20)
  const [settlementsPerDay, setSettlementsPerDay] = useState(3)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        seed: String(seed),
        orderCount: String(orderCount),
        days: String(days),
        settlementsPerDay: String(settlementsPerDay),
      })
      const response = await fetch(`/api/data/preview?${params}`)
      if (response.ok) setPreview(await response.json())
    } finally {
      setLoading(false)
    }
  }, [seed, orderCount, days, settlementsPerDay])

  useEffect(() => {
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [load])

  async function generateAndRun() {
    setRunning(true)
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, orderCount, days, settlementsPerDay, useAdjudicator: true }),
      })
      const data = await response.json()
      if (response.ok) router.push(`/runs/${data.runId}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Data studio"
        title="Generate the batch"
        description="Three sources built from one integer. The same seed always produces the same orders, the same payouts, the same mangled narrations — which is what makes a reported accuracy figure something you can check rather than take on trust."
        actions={
          <Button
            size="lg"
            onClick={generateAndRun}
            disabled={running}
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Generate and reconcile
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Parameters</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSeed(Math.floor(Math.random() * 100000))}
                className="gap-1.5 text-muted-foreground"
              >
                <RefreshCw className="size-3" />
                Random seed
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Seed', value: seed, set: setSeed, min: 0, max: 2147483647 },
                { label: 'Orders', value: orderCount, set: setOrderCount, min: 10, max: 5000 },
                { label: 'Days', value: days, set: setDays, min: 5, max: 90 },
                { label: 'Payouts / day', value: settlementsPerDay, set: setSettlementsPerDay, min: 1, max: 8 },
              ].map((f) => (
                <label key={f.label} className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {f.label}
                  </span>
                  <input
                    type="number"
                    className={inputClass}
                    value={f.value}
                    min={f.min}
                    max={f.max}
                    onChange={(e) => f.set(Number(e.target.value))}
                  />
                </label>
              ))}
            </div>

            <p className="border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
              Exception counts scale with the population each class can occur in — fee drift per
              payment, missing payouts per batch — so every class stays represented from 50 orders
              up to 5,000.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">What this seed produces</h2>
              {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>

            {preview && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                  {[
                    { label: 'Orders', value: preview.sources.orders },
                    { label: 'Settlement lines', value: preview.sources.settlementLines },
                    { label: 'Bank lines', value: preview.sources.bankLines },
                    { label: 'Payout batches', value: preview.sources.payoutBatches },
                    { label: 'Total records', value: preview.sources.records },
                  ].map((s) => (
                    <div key={s.label}>
                      <p className="amount text-xl font-semibold">{s.value.toLocaleString('en-IN')}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 border-t border-border/60 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Failure modes planted · {preview.truth.l1Pairs + preview.truth.l2Pairs} true pairs to find
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {preview.planted.map((p) => (
                      <Badge key={p.code} variant={SEVERITY_VARIANT[p.severity]}>
                        {p.label}
                        <span className="amount ml-1 font-semibold">{p.count}</span>
                      </Badge>
                    ))}
                  </div>
                </div>

                <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
                  Ground truth for all {preview.truth.l1Pairs + preview.truth.l2Pairs} pairs is
                  recorded as the data is built and never read by the engine — only by the grader.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Export the latest run</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXPORTS.map((e) => (
            <a
              key={e.kind}
              href={`/api/export?kind=${e.kind}`}
              className={cn(
                'flex items-center gap-3 rounded-2xl border border-border bg-card/70 p-4 backdrop-blur-sm transition-colors',
                'hover:border-primary/40',
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Download className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{e.label}</p>
                <p className="truncate text-xs text-muted-foreground">{e.note}</p>
              </div>
            </a>
          ))}
        </div>
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Database className="mt-0.5 size-3.5 shrink-0" />
          Journal entries cover only payouts that actually reconciled. Proposing an entry for a
          settlement the bank never received would put unproven money into the books.
        </p>
      </section>
    </div>
  )
}
