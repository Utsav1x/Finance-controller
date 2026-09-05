'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EvidenceTrail } from '@/components/recon/evidence-trail'
import { ReasonBadge, StateBadge, TierBadge } from '@/components/recon/state-badge'
import { Money, Delta } from '@/components/recon/money'
import { cn } from '@/lib/utils'
import { formatDayShort } from '@/lib/format-date'
import type { EvidenceItem, MatchState } from '@/lib/recon/types'

export interface WorkspaceRow {
  id: string
  level: 'L1' | 'L2'
  state: MatchState
  tier: number
  confidence: number
  leftLabel: string
  leftDetail: string
  leftPaise: number
  rightLabel: string
  rightDetail: string
  rightPaise: number
  day: string
  varianceCode: string | null
  variancePaise: number
  rationale: string | null
  evidence: EvidenceItem[]
}

const FILTERS: { key: MatchState | 'all'; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'matched', label: 'Matched' },
  { key: 'review', label: 'Review' },
  { key: 'exception', label: 'Exception' },
]

export function Workspace({ rows }: { rows: WorkspaceRow[] }) {
  const [level, setLevel] = useState<'L2' | 'L1'>('L2')
  const [filter, setFilter] = useState<MatchState | 'all'>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const counts = useMemo(() => {
    const inLevel = rows.filter((r) => r.level === level)
    return {
      all: inLevel.length,
      matched: inLevel.filter((r) => r.state === 'matched').length,
      review: inLevel.filter((r) => r.state === 'review').length,
      exception: inLevel.filter((r) => r.state === 'exception').length,
    }
  }, [rows, level])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (r.level !== level) return false
      if (filter !== 'all' && r.state !== filter) return false
      if (!needle) return true
      return (
        r.leftLabel.toLowerCase().includes(needle) ||
        r.rightLabel.toLowerCase().includes(needle) ||
        r.leftDetail.toLowerCase().includes(needle) ||
        r.rightDetail.toLowerCase().includes(needle)
      )
    })
  }, [rows, level, filter, query])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border p-0.5">
          {(
            [
              ['L2', 'Payouts → bank'],
              ['L1', 'Orders → gateway'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setLevel(key)
                setOpen(null)
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                level === key
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                filter === f.key
                  ? 'border-primary/40 bg-primary/15 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {f.label}
              <span className="amount ml-1.5 text-muted-foreground">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an id, UTR or narration…"
            className="h-9 w-64 rounded-lg border border-border bg-card/60 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* ── Rows ────────────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Nothing matches that filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y divide-border/60 p-0">
            {visible.slice(0, 200).map((row) => {
              const expanded = open === row.id
              return (
                <div key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : row.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/40"
                  >
                    <ChevronRight
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        expanded && 'rotate-90',
                      )}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="amount truncate text-sm font-medium">{row.leftLabel}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.leftDetail}</p>
                    </div>

                    <Money paise={row.leftPaise} className="hidden w-32 shrink-0 text-right text-sm sm:block" />

                    <span className="hidden shrink-0 text-muted-foreground sm:block">→</span>

                    <div className="hidden min-w-0 flex-1 md:block">
                      <p className="amount truncate text-sm">{row.rightLabel}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.rightDetail}</p>
                    </div>

                    <span className="amount hidden w-16 shrink-0 text-right text-xs text-muted-foreground lg:block">
                      {formatDayShort(row.day)}
                    </span>

                    <div className="flex shrink-0 items-center gap-2">
                      {row.varianceCode && <ReasonBadge code={row.varianceCode} />}
                      <StateBadge state={row.state} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-border/60 bg-background/40 p-5">
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <TierBadge tier={row.tier} />
                        <Badge variant="outline" className="text-[0.65rem]">
                          confidence {row.confidence.toFixed(2)}
                        </Badge>
                        {row.variancePaise !== 0 && (
                          <span className="text-xs text-muted-foreground">
                            variance <Delta paise={row.variancePaise} />
                          </span>
                        )}
                      </div>

                      {row.rationale && (
                        <p className="mb-4 rounded-xl border border-accent/25 bg-accent/5 p-3 text-sm leading-relaxed text-muted-foreground">
                          <span className="font-medium text-accent">Adjudicator: </span>
                          {row.rationale}
                        </p>
                      )}

                      <EvidenceTrail evidence={row.evidence} />
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {visible.length > 200 && (
        <p className="text-center text-xs text-muted-foreground">
          Showing the first 200 of {visible.length}. Narrow with the search box.
        </p>
      )}
    </div>
  )
}
