import { cn } from '@/lib/utils'

const TIER_META: Record<string, { label: string; className: string }> = {
  tier1: { label: 'Reference', className: 'bg-primary' },
  tier2: { label: 'Amount + date', className: 'bg-accent' },
  tier3: { label: 'Scored / summed', className: 'bg-success' },
  tier4: { label: 'Adjudicated', className: 'bg-warning' },
}

/**
 * Which tier did the work.
 *
 * This is the chart that keeps the product honest about its own AI. If tier 4
 * carries almost nothing, the deterministic rules are doing the job and the
 * model is an expensive garnish; if it carries almost everything, the rules are
 * not earning their keep and the match rate is a model's opinion. Either
 * reading is useful, and neither is visible from a match rate alone.
 */
export function TierBar({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">Nothing matched in this run.</p>
  }

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {entries.map(([tier, count]) => (
          <div
            key={tier}
            className={cn('h-full transition-all duration-700', TIER_META[tier]?.className ?? 'bg-muted-foreground')}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${TIER_META[tier]?.label ?? tier}: ${count}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {entries.map(([tier, count]) => (
          <li key={tier} className="flex items-center gap-2 text-xs">
            <span
              className={cn('size-2 rounded-full', TIER_META[tier]?.className ?? 'bg-muted-foreground')}
            />
            <span className="text-muted-foreground">{TIER_META[tier]?.label ?? tier}</span>
            <span className="amount font-medium">{count}</span>
            <span className="amount text-muted-foreground">
              {((count / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
