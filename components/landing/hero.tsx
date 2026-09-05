import { ArrowRight, Gauge, ScanLine } from 'lucide-react'
import { LinkButton } from '@/components/ui/link-button'
import { Badge } from '@/components/ui/badge'

/**
 * The visual is the product's own three-source structure rather than an
 * illustration of one. Someone who understands the problem should be able to
 * read the shape of the solution off the landing page: many payments collapse
 * into one payout, one payout becomes one bank credit, and the interesting
 * part is everything that does not follow that path.
 */
function ThreeSourceVisual() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-primary/25 via-accent/15 to-transparent blur-2xl" />
      <div className="glow-border relative overflow-hidden rounded-3xl border border-border bg-card/60 p-5">
        <div className="grid grid-cols-3 gap-3 text-[0.65rem]">
          {[
            { title: 'Order ledger', tone: 'text-primary', rows: ['ORD-00412  ₹2,499.00', 'ORD-00413  ₹899.00', 'ORD-00414  ₹14,200.00', 'ORD-00415  ₹1,050.00'] },
            { title: 'Gateway settlement', tone: 'text-accent', rows: ['STL-00412  −₹58.98 fee', 'STL-00413  −₹21.22 fee', 'STL-00414  −₹335.12 fee', 'REFUND     −₹899.00'] },
            { title: 'Bank statement', tone: 'text-success', rows: ['UTR8834729911', '₹16,434.68', 'value 14 Aug', 'NEFT CR RAZORPAY'] },
          ].map((col) => (
            <div key={col.title} className="rounded-xl border border-border/70 bg-background/40 p-3">
              <p className={`mb-2.5 text-[0.6rem] font-medium uppercase tracking-wider ${col.tone}`}>
                {col.title}
              </p>
              <ul className="amount flex flex-col gap-1.5 text-muted-foreground">
                {col.rows.map((row) => (
                  <li key={row} className="truncate">{row}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-background/70 p-3 backdrop-blur-md">
          <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-success/20 text-success">
            <span className="absolute inset-0 rounded-xl bg-success/30 animate-pulse-ring" />
            <ScanLine className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Matched on reference · 4 lines → 1 credit</p>
            <p className="truncate text-xs text-muted-foreground">
              Net of ₹899.00 refund and ₹415.32 in fees · settled T+2
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-8 lg:py-28">
        <div className="relative">
          <Badge variant="outline" className="mb-6 gap-2 border-primary/30 bg-primary/10 text-primary">
            <Gauge />
            Measured against ground truth, not self-graded
          </Badge>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Close the settlement loop, and <span className="text-gradient">prove you closed it</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            Ledgerly reconciles your order ledger, gateway settlements and bank statement in one
            pass — then reports its precision, its recall, and every record it could not resolve.
            Including the matches it got wrong.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LinkButton
              href="/run"
              size="lg"
              className="h-11 bg-gradient-to-r from-primary to-accent px-5 text-base text-primary-foreground"
            >
              Reconcile a batch
              <ArrowRight />
            </LinkButton>
            <LinkButton href="/scorecard" variant="outline" size="lg" className="h-11 px-5 text-base">
              <Gauge />
              See the scorecard
            </LinkButton>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
            <div>
              <span className="amount font-semibold text-foreground">10</span> exception classes
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="amount font-semibold text-foreground">4</span> matching tiers
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="amount font-semibold text-foreground">0</span> API keys required
            </div>
          </div>
        </div>

        <ThreeSourceVisual />
      </div>
    </section>
  )
}
