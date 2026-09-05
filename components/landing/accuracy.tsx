import { Card, CardContent } from '@/components/ui/card'

const CLASSES = [
  ['Fee drift', 'The rate quietly changed. Everything matches; the cash is short.'],
  ['Timing gap', 'Settled Friday, credited Tuesday. A weekend is not a variance.'],
  ['Partial refund', 'A refund nets off inside the payout, so the credit is smaller than the payments.'],
  ['Chargeback', 'A dispute deducted from an otherwise clean batch.'],
  ['Duplicate capture', 'One reference on two orders. A reference join matches both and reports success.'],
  ['Payout never landed', 'Reported by the gateway, absent from the bank. Real money, missing.'],
  ['Unidentified credit', 'Money in from somewhere else. Forcing it onto a settlement is how precision dies.'],
  ['Rounding drift', 'A few paise of per-line rounding, enough to break equality.'],
  ['Unreadable narration', 'The reference survived the export, but not intact.'],
  ['Split payout', 'One batch, two credits. No single line looks right; together they are exact.'],
]

export function Accuracy() {
  return (
    <section id="accuracy" className="relative border-t border-border/60 py-20 sm:py-24">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          <p className="mb-2 text-sm font-medium text-primary">Accuracy</p>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            A match rate is not an accuracy
          </h2>
          <div className="mt-4 flex flex-col gap-4 text-pretty leading-relaxed text-muted-foreground">
            <p>
              Match rate measures how often the engine felt finished. Precision measures how often
              it was right. A matcher that pairs every record with its nearest neighbour scores
              magnificently on the first and is worthless.
            </p>
            <p>
              So the synthetic data carries ground truth, written as it is generated, before the
              engine sees any of it. Runs are graded against that: true positives, false negatives,
              and the number most demos have no way to compute —{' '}
              <span className="font-medium text-foreground">false positives</span>, the matches the
              engine asserted that were simply wrong.
            </p>
            <p>
              Every run is reproducible from a seed. Loosen the tolerances and precision falls in a
              way you can watch, which is the point: the trade between coverage and correctness
              becomes a measurement instead of an argument.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Ten failure modes, planted deliberately
            </p>
            <ul className="mt-4 flex flex-col divide-y divide-border/60">
              {CLASSES.map(([name, note]) => (
                <li key={name} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium">{name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{note}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
