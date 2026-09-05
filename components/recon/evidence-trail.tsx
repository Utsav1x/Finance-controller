import { Check, X } from 'lucide-react'
import type { EvidenceItem } from '@/lib/recon/types'
import { cn } from '@/lib/utils'
import { formatDelta } from '@/lib/format-money'

/**
 * Why the engine believes a match.
 *
 * Every field it compared, both values, and whether they agreed — including the
 * ones that did not. A trail that only listed the evidence in favour would be a
 * justification rather than a record, and the disagreements are usually the
 * interesting part: this is where a reviewer sees that the amounts matched
 * perfectly but the reference never appeared.
 */
export function EvidenceTrail({ evidence }: { evidence: EvidenceItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border/60">
      {evidence.map((item, i) => (
        <li key={`${item.field}-${i}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
          <span
            className={cn(
              'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full',
              item.agrees ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
            )}
          >
            {item.agrees ? <Check className="size-2.5" /> : <X className="size-2.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{item.field}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="amount break-all text-foreground/90">{item.left}</span>
              <span className="text-muted-foreground">→</span>
              <span className="amount break-all text-foreground/90">{item.right}</span>
              {item.deltaPaise !== undefined && item.deltaPaise !== 0 && (
                <span className="amount text-xs text-warning">
                  ({formatDelta(item.deltaPaise)})
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
