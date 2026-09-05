import { cn } from '@/lib/utils'
import { formatCompact, formatDelta, formatMoney } from '@/lib/format-money'

/**
 * Every amount in the product renders through here.
 *
 * The `.amount` class carries tabular figures, which is the difference between
 * a column of numbers a reviewer can scan down and one they have to read.
 */
export function Money({
  paise,
  compact = false,
  className,
}: {
  paise: number
  compact?: boolean
  className?: string
}) {
  return (
    <span className={cn('amount', className)}>
      {compact ? formatCompact(paise) : formatMoney(paise)}
    </span>
  )
}

/**
 * A variance. Zero is muted rather than green — nothing happened, and colouring
 * it as a success trains people to stop reading the column.
 */
export function Delta({ paise, className }: { paise: number; className?: string }) {
  return (
    <span
      className={cn(
        'amount',
        paise === 0
          ? 'text-muted-foreground'
          : Math.abs(paise) < 500
            ? 'text-warning'
            : 'text-destructive',
        className,
      )}
    >
      {formatDelta(paise)}
    </span>
  )
}
