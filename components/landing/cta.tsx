import { ArrowRight, TerminalSquare } from 'lucide-react'
import { LinkButton } from '@/components/ui/link-button'
import { Card, CardContent } from '@/components/ui/card'

export function CTA() {
  return (
    <section className="relative border-t border-border/60 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
        <Card className="glow-border overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
          <CardContent className="relative p-8 text-center sm:p-12">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Reconcile a batch and read the scorecard
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
              Everything runs locally against generated data. No key, no account, no setup — and
              the accuracy figures are computed the same way whether you trust us or not.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <LinkButton
                href="/run"
                size="lg"
                className="h-11 bg-gradient-to-r from-primary to-accent px-5 text-base text-primary-foreground"
              >
                Reconcile a batch
                <ArrowRight />
              </LinkButton>
              <LinkButton href="/data" variant="outline" size="lg" className="h-11 px-5 text-base">
                <TerminalSquare />
                Generate harder data
              </LinkButton>
            </div>
            <p className="amount mt-6 text-xs text-muted-foreground">
              or: pnpm bench — the same numbers, from the terminal, with no UI in the way
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
        <p>Ledgerly — AI Finance Controller</p>
        <p className="text-xs">
          Synthetic data throughout. No real merchant, bank or gateway records are involved.
        </p>
      </div>
    </footer>
  )
}
