import { Layers, ScanSearch, Sigma, Sparkles, TriangleAlert } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

const TIERS = [
  {
    tier: 'Tier 1',
    icon: ScanSearch,
    title: 'Reference',
    body: 'The batch UTR, found intact in a bank narration. Every leg carrying it is collected before anything is decided, and the legs must sum to the batch — a reference is not a receipt.',
    tone: 'text-primary',
  },
  {
    tier: 'Tier 2',
    icon: Sigma,
    title: 'Amount and date',
    body: 'Batch total against one credit, inside a tolerance band and a business-day window. A runner-up that is equally close makes it a question, not a match.',
    tone: 'text-accent',
  },
  {
    tier: 'Tier 3',
    icon: Layers,
    title: 'Scored, and summed',
    body: 'A mangled reference is not a missing one. Partial signals combine, and a bounded subset-sum recovers payouts that arrived in two pieces.',
    tone: 'text-success',
  },
  {
    tier: 'Tier 4',
    icon: Sparkles,
    title: 'Adjudicated',
    body: 'Only what survives the rules reaches a model, with every delta precomputed. It answers with a confidence and a reason — and below the floor, the answer becomes an exception.',
    tone: 'text-warning',
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="relative border-t border-border/60 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="mb-2 text-sm font-medium text-primary">How it works</p>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Four tiers, cheapest and most certain first
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Each tier only sees what the one before it could not resolve. That ordering is what
            makes the result auditable: most matches are explained by a rule you can read, and the
            scorecard shows exactly how much work the model actually did.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t) => {
            const Icon = t.icon
            return (
              <Card key={t.tier} className="transition-colors hover:border-primary/40">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2">
                    <Icon className={`size-4 ${t.tone}`} />
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t.tier}
                    </span>
                  </div>
                  <h3 className="mt-3 font-semibold">{t.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <Card className="mt-4 border-destructive/25 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
              <TriangleAlert className="size-5" />
            </span>
            <div>
              <h3 className="font-semibold">And then the honest list</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Whatever no tier could resolve is reported with a reason code, the amount at risk,
                and the candidates that were considered and rejected — never quietly dropped, and
                never matched to the nearest thing available to make a number look better.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
