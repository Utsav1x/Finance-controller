import { CheckCircle2, CircleAlert, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { MatchState } from '@/lib/recon/types'
import { reasonCode, type Severity } from '@/lib/recon/reason-codes'
import { cn } from '@/lib/utils'

const STATE_META: Record<MatchState, { label: string; variant: 'success' | 'warning' | 'destructive'; Icon: typeof CheckCircle2 }> = {
  matched: { label: 'Matched', variant: 'success', Icon: CheckCircle2 },
  review: { label: 'Review', variant: 'warning', Icon: CircleAlert },
  exception: { label: 'Exception', variant: 'destructive', Icon: TriangleAlert },
}

export function StateBadge({ state, className }: { state: MatchState; className?: string }) {
  const { label, variant, Icon } = STATE_META[state]
  return (
    <Badge variant={variant} className={className}>
      <Icon />
      {label}
    </Badge>
  )
}

const SEVERITY_VARIANT: Record<Severity, 'destructive' | 'warning' | 'outline'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'outline',
}

export function ReasonBadge({ code, className }: { code: string; className?: string }) {
  const reason = reasonCode(code)
  return (
    <Badge variant={SEVERITY_VARIANT[reason.severity]} className={className}>
      {reason.label}
    </Badge>
  )
}

/** Which tier resolved a match. Kept visually quiet — it is provenance, not status. */
export function TierBadge({ tier, className }: { tier: number; className?: string }) {
  const label =
    tier === 1 ? 'reference' : tier === 2 ? 'amount + date' : tier === 3 ? 'scored' : tier === 4 ? 'adjudicated' : 'normalized'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider text-muted-foreground',
        tier === 4 && 'border-accent/30 text-accent',
        className,
      )}
    >
      T{tier} · {label}
    </span>
  )
}
