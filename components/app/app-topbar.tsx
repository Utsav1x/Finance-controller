'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BookOpen, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarContent } from '@/components/app/app-sidebar'

export function AppTopbar({ title }: { title?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          <Menu />
        </Button>

        {title && (
          <h1 className="text-sm font-medium text-muted-foreground lg:hidden">{title}</h1>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/scorecard"
            className="hidden items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:inline-flex"
          >
            <BookOpen className="size-3.5" />
            How accuracy is measured
          </Link>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 border-r border-border bg-sidebar shadow-2xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-10"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
