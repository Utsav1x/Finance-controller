import {
  Database,
  FileSpreadsheet,
  Gauge,
  MessagesSquare,
  ScrollText,
  SlidersHorizontal,
  TriangleAlert,
  Wallet,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

const FEATURES = [
  {
    icon: TriangleAlert,
    title: 'Exception queue',
    body: 'Every unresolved record with its reason code, amount at risk, suggested action, and the candidates the engine rejected — with why.',
  },
  {
    icon: Gauge,
    title: 'Scorecard',
    body: 'Precision, recall, F1, false positives, per-class recall, tier attribution, wall clock, tokens and cost. Comparable run over run.',
  },
  {
    icon: MessagesSquare,
    title: 'Ask the ledger',
    body: 'Questions answered by running typed queries over the reconciled records, then citing them. No retrieval over prose, no invented totals.',
  },
  {
    icon: Wallet,
    title: 'Cash position',
    body: 'A forward view built only from reconciled inflows and the settlement pipeline, with the band widening as unreconciled exposure grows.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Rules and tolerances',
    body: 'Date window, amount band, fee schedule, confidence floor. Change one, re-run, and watch precision move on the scorecard.',
  },
  {
    icon: Database,
    title: 'Data studio',
    body: 'Regenerate the batch with a seed, a size, and per-class exception counts. Same seed, same data, every time.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Journal entries',
    body: 'Export the run as proposed Dr/Cr lines for fees, GST, refunds and chargebacks — what actually has to be posted at close.',
  },
  {
    icon: ScrollText,
    title: 'Agent activity log',
    body: 'Every decision in order, with the reasoning attached to the ones a model made. Nothing in the run is unexplainable.',
  },
]

export function Features() {
  return (
    <section id="features" className="relative border-t border-border/60 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="mb-2 text-sm font-medium text-primary">Features</p>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Built for the person who has to sign off
          </h2>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <Card key={f.title} className="transition-colors hover:border-primary/40">
                <CardContent className="p-5">
                  <span className="grid size-9 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </span>
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
