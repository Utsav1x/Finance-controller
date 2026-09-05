'use client'

import { useState } from 'react'
import { Check, ChevronRight, Loader2, RotateCcw, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ReasonBadge } from '@/components/recon/state-badge'
import { Money } from '@/components/recon/money'
import { cn } from '@/lib/utils'
import { formatDay } from '@/lib/format-date'
import { reasonCode, SEVERITY_ORDER } from '@/lib/recon/reason-codes'
import type { ReconException } from '@/lib/recon/types'

export type QueueItem = ReconException & { note: string | null; resolvedAt: string | null }

const RESOLUTIONS = [
  { key: 'accepted', label: 'Accept', icon: Check, tone: 'text-success' },
  { key: 'rejected', label: 'Reject', icon: X, tone: 'text-destructive' },
  { key: 'reassigned', label: 'Reassign', icon: RotateCcw, tone: 'text-accent' },
] as const

export function ExceptionQueue({
  runId,
  initial,
  focus,
}: {
  runId: string
  initial: QueueItem[]
  focus?: string
}) {
  const [items, setItems] = useState(initial)
  const [showResolved, setShowResolved] = useState(false)
  const [codeFilter, setCodeFilter] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(focus ?? null)
  const [busy, setBusy] = useState<string | null>(null)

  const codes = [...new Set(initial.map((e) => e.code))].sort()

  const visible = items
    .filter((e) => (showResolved ? true : e.resolution === 'open'))
    .filter((e) => codeFilter === 'all' || e.code === codeFilter)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[reasonCode(a.code).severity] - SEVERITY_ORDER[reasonCode(b.code).severity] ||
        b.amountPaise - a.amountPaise,
    )

  const openCount = items.filter((e) => e.resolution === 'open').length
  const atRisk = items
    .filter((e) => e.resolution === 'open')
    .reduce((sum, e) => sum + Math.abs(e.amountPaise), 0)

  async function resolve(exceptionId: string, resolution: QueueItem['resolution']) {
    setBusy(exceptionId)
    // Optimistic: the queue is a working surface and a round-trip delay on every
    // click makes triaging thirty items feel broken. Reverted if the write fails.
    const previous = items
    setItems((current) =>
      current.map((e) => (e.exceptionId === exceptionId ? { ...e, resolution } : e)),
    )
    try {
      const response = await fetch('/api/exceptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, exceptionId, resolution }),
      })
      if (!response.ok) throw new Error('write failed')
    } catch {
      setItems(previous)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCodeFilter('all')}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs transition-colors',
              codeFilter === 'all'
                ? 'border-primary/40 bg-primary/15 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            All <span className="amount ml-1.5">{items.length}</span>
          </button>
          {codes.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setCodeFilter(code)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                codeFilter === code
                  ? 'border-primary/40 bg-primary/15 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {reasonCode(code).label}
              <span className="amount ml-1.5">
                {items.filter((e) => e.code === code).length}
              </span>
            </button>
          ))}
        </div>

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="size-3.5 accent-[oklch(0.62_0.19_258)]"
          />
          Show resolved
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          <span className="amount font-semibold text-warning">{openCount}</span> open
        </span>
        <span className="text-muted-foreground">
          <span className="amount font-semibold text-warning">
            <Money paise={atRisk} />
          </span>{' '}
          at risk
        </span>
        <span className="text-xs text-muted-foreground">
          Every one of these was reported rather than matched to the nearest available record.
        </span>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {openCount === 0 && !showResolved
              ? 'Nothing open. Every record in this run was accounted for.'
              : 'Nothing matches that filter.'}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y divide-border/60 p-0">
            {visible.map((e) => {
              const reason = reasonCode(e.code)
              const expanded = open === e.exceptionId
              return (
                <div
                  key={e.exceptionId}
                  className={cn(e.resolution !== 'open' && 'opacity-55')}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : e.exceptionId)}
                    aria-expanded={expanded}
                    className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40"
                  >
                    <ChevronRight
                      className={cn(
                        'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
                        expanded && 'rotate-90',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ReasonBadge code={e.code} />
                        <span className="amount text-xs text-muted-foreground">{e.recordId}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDay(e.occurredOn)}
                        </span>
                        {e.resolution !== 'open' && (
                          <Badge variant="outline" className="text-[0.65rem]">
                            {e.resolution}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                        {e.rationale ?? reason.description}
                      </p>
                    </div>
                    <Money paise={e.amountPaise} className="shrink-0 text-sm font-medium" />
                  </button>

                  {expanded && (
                    <div className="border-t border-border/60 bg-background/40 p-5">
                      <div className="grid gap-5 lg:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            What happened
                          </p>
                          <p className="mt-2 text-sm leading-relaxed">{reason.description}</p>

                          <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            What to do
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {reason.action}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Candidates considered
                          </p>
                          {e.rejected.length === 0 ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                              None came close enough on amount, date or reference to be worth
                              showing.
                            </p>
                          ) : (
                            <ul className="mt-2 flex flex-col divide-y divide-border/60">
                              {e.rejected.map((c) => (
                                <li key={c.candidateId} className="py-2 first:pt-0 last:pb-0">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="amount text-sm">{c.candidateId}</span>
                                    <span className="amount text-xs text-muted-foreground">
                                      score {c.score}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                    {c.reason}
                                  </p>
                                  <p className="amount mt-0.5 text-xs text-muted-foreground">
                                    Δ {c.deltaPaise} paise · {c.dayGap} day gap
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                        {RESOLUTIONS.map((r) => {
                          const Icon = r.icon
                          const active = e.resolution === r.key
                          return (
                            <Button
                              key={r.key}
                              variant={active ? 'secondary' : 'outline'}
                              size="sm"
                              disabled={busy === e.exceptionId}
                              onClick={() => resolve(e.exceptionId, r.key)}
                              className="gap-1.5"
                            >
                              {busy === e.exceptionId ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Icon className={cn('size-3', active && r.tone)} />
                              )}
                              {r.label}
                            </Button>
                          )
                        })}
                        {e.resolution !== 'open' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resolve(e.exceptionId, 'open')}
                            className="gap-1.5 text-muted-foreground"
                          >
                            <RotateCcw className="size-3" />
                            Reopen
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
