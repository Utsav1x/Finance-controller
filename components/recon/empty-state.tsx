import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { LinkButton } from '@/components/ui/link-button'

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon
  title: string
  body: string
  action?: { href: string; label: string }
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-2xl border border-border bg-muted/50 text-muted-foreground">
          <Icon className="size-6" />
        </span>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">{body}</p>
        {action && (
          <LinkButton
            href={action.href}
            size="lg"
            className="mt-2 h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            {action.label}
          </LinkButton>
        )}
      </CardContent>
    </Card>
  )
}
