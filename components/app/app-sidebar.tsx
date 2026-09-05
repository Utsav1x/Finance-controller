'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Play, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/logo'
import { LinkButton } from '@/components/ui/link-button'
import { navSections } from '@/components/app/nav-items'
import { formatRelative } from '@/lib/format-date'

type LastRun = {
  id: string
  label: string
  createdAt: string
  autoMatchRate: number
  openExceptions: number
}

/**
 * Sits where a user card would in a multi-tenant app. In a controller's tool
 * the standing question is not "who am I" but "is the book currently clean",
 * so the corner shows the last run's match rate and open exception count.
 */
function LastRunCard() {
  const [run, setRun] = useState<LastRun | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/runs?limit=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRun(data?.runs?.[0] ?? null))
      .catch(() => setRun(null))
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-3">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-5 w-28 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!run) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">No runs yet</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Generate a batch and reconcile it to see results here.
        </p>
      </div>
    )
  }

  const clean = run.openExceptions === 0

  return (
    <Link
      href={`/runs/${run.id}`}
      className="block rounded-xl border border-border bg-card/60 p-3 transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Last run</p>
        <span className="text-xs text-muted-foreground">{formatRelative(run.createdAt)}</span>
      </div>
      <p className="mt-2 truncate text-sm font-medium">{run.label}</p>
      <div className="mt-2 flex items-center gap-3 text-xs">
        <span className="amount font-semibold text-success">
          {(run.autoMatchRate * 100).toFixed(1)}%
        </span>
        <span className="text-muted-foreground">matched</span>
        <span
          className={cn(
            'ml-auto inline-flex items-center gap-1',
            clean ? 'text-muted-foreground' : 'text-warning',
          )}
        >
          {!clean && <TriangleAlert className="size-3" />}
          <span className="amount">{run.openExceptions}</span> open
        </span>
      </div>
    </Link>
  )
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 pt-2">
        <Logo />
      </div>

      <LinkButton
        href="/run"
        onClick={onNavigate}
        className="w-full justify-center gap-2 bg-gradient-to-r from-primary to-accent py-2 text-primary-foreground"
      >
        <Play className="size-4" />
        Run Reconciliation
      </LinkButton>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {section.title}
            </p>
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active
                          ? 'bg-primary/15 text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 transition-colors',
                          active
                            ? 'text-primary'
                            : 'text-muted-foreground group-hover:text-foreground',
                        )}
                      />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <LastRunCard />
    </div>
  )
}

export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r border-border/60 bg-sidebar/60 backdrop-blur-xl lg:block">
      <SidebarContent />
    </aside>
  )
}
