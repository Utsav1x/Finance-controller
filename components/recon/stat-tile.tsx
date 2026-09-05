import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatTile({
  label,
  value,
  note,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  note?: string
  icon: LucideIcon
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const noteTone = {
    neutral: 'text-muted-foreground',
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-destructive',
  }[tone]

  const iconTone = {
    neutral: 'border-primary/20 bg-primary/10 text-primary',
    good: 'border-success/20 bg-success/10 text-success',
    warn: 'border-warning/20 bg-warning/10 text-warning',
    bad: 'border-destructive/20 bg-destructive/10 text-destructive',
  }[tone]

  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="amount mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          {note && <p className={cn('mt-1 text-xs', noteTone)}>{note}</p>}
        </div>
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl border', iconTone)}>
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  )
}
