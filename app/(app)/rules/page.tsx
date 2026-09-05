'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, RotateCcw, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/app/page-header'
import { DEFAULT_TOLERANCES, RECKLESS_TOLERANCES, type Tolerances } from '@/lib/recon/tolerances'

const FIELDS: {
  key: keyof Tolerances
  label: string
  hint: string
  step?: number
  group: 'Matching' | 'Fees' | 'Confidence' | 'Budget'
}[] = [
  {
    key: 'roundingPaise',
    label: 'Rounding allowance (paise)',
    hint: 'Absolute difference a batch total may have from a bank credit. Covers per-line rounding.',
    group: 'Matching',
  },
  {
    key: 'amountBps',
    label: 'Amount band (bps)',
    hint: 'Relative allowance on top of the absolute one, so the tolerance scales with the payout.',
    group: 'Matching',
  },
  {
    key: 'dateWindowDays',
    label: 'Date window (business days)',
    hint: 'How long after settlement a credit may land. Weekends and bank holidays are excluded.',
    group: 'Matching',
  },
  {
    key: 'maxSplitLegs',
    label: 'Max split legs',
    hint: 'How many bank credits may be summed to satisfy one payout. Higher is slower and riskier.',
    group: 'Matching',
  },
  {
    key: 'feeBps',
    label: 'Contracted fee (bps)',
    hint: 'What the gateway agreed to charge. Deviation from this is what fee drift measures.',
    group: 'Fees',
  },
  {
    key: 'feeTaxRate',
    label: 'GST on fee',
    hint: 'Tax rate applied to the gateway fee.',
    step: 0.01,
    group: 'Fees',
  },
  {
    key: 'feeDriftBps',
    label: 'Fee drift threshold (bps)',
    hint: 'Deviation beyond this is reported as a variance rather than absorbed silently.',
    group: 'Fees',
  },
  {
    key: 'fuzzyAcceptScore',
    label: 'Tier-3 accept score',
    hint: 'Minimum weighted score to accept a scored match without asking a model.',
    step: 0.01,
    group: 'Confidence',
  },
  {
    key: 'ambiguityMargin',
    label: 'Ambiguity margin',
    hint: 'How far the best candidate must beat the runner-up. Below this it becomes a question, not a match.',
    step: 0.01,
    group: 'Confidence',
  },
  {
    key: 'llmConfidenceFloor',
    label: 'Adjudicator floor',
    hint: 'Minimum model confidence to record a match. Below it, the record becomes an exception.',
    step: 0.01,
    group: 'Confidence',
  },
  {
    key: 'maxLlmCalls',
    label: 'Max model calls per run',
    hint: 'Hard cap so one bad batch cannot spend a day of quota.',
    group: 'Budget',
  },
]

const GROUPS = ['Matching', 'Fees', 'Confidence', 'Budget'] as const

export default function RulesPage() {
  const [tolerances, setTolerances] = useState<Tolerances>(DEFAULT_TOLERANCES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/rules')
      .then((r) => r.json())
      .then((d) => setTolerances(d.tolerances))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function set(key: keyof Tolerances, value: number) {
    setTolerances((t) => ({ ...t, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tolerances),
      })
      const data = await response.json()
      if (response.ok) {
        setTolerances(data.tolerances)
        setSaved(true)
      }
    } finally {
      setSaving(false)
    }
  }

  const isReckless = tolerances.dateWindowDays >= 14 && tolerances.amountBps >= 500

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Rules"
        title="Tolerances"
        description="Everything the engine is allowed to be lenient about. Loosening these raises the match rate and lowers precision — and because runs are graded against ground truth, you can watch that trade instead of arguing about it."
        actions={
          <Button
            size="lg"
            onClick={save}
            disabled={saving || loading}
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {saved ? 'Saved' : 'Save profile'}
          </Button>
        }
      />

      <Card className={isReckless ? 'border-destructive/40 bg-destructive/5' : undefined}>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl border ${
              isReckless
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-primary/20 bg-primary/10 text-primary'
            }`}
          >
            {isReckless ? <ShieldAlert className="size-5" /> : <SlidersHorizontal className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {isReckless ? 'Reckless profile loaded' : 'Presets'}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {isReckless
                ? 'This profile will match almost anything within ₹500 and a fortnight. Run it and check the scorecard: false positives must appear. If they do not, the grader is not grading and no accuracy figure in this app can be trusted.'
                : 'Load the reckless profile and re-run to verify the scorecard can actually fail. A metric that never reports a false positive is decorative.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTolerances(DEFAULT_TOLERANCES)
                setSaved(false)
              }}
              className="gap-1.5"
            >
              <RotateCcw className="size-3" />
              Default
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTolerances(RECKLESS_TOLERANCES)
                setSaved(false)
              }}
              className="gap-1.5"
            >
              <ShieldAlert className="size-3" />
              Reckless
            </Button>
          </div>
        </CardContent>
      </Card>

      {GROUPS.map((group) => (
        <section key={group}>
          <h2 className="mb-4 text-lg font-semibold">{group}</h2>
          <Card>
            <CardContent className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
              {FIELDS.filter((f) => f.group === group).map((field) => (
                <label key={field.key} className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{field.label}</span>
                  <input
                    type="number"
                    step={field.step ?? 1}
                    value={tolerances[field.key]}
                    onChange={(e) => set(field.key, Number(e.target.value))}
                    disabled={loading}
                    className="amount h-9 w-full rounded-lg border border-border bg-card/60 px-3 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                  />
                  <span className="text-xs leading-relaxed text-muted-foreground">{field.hint}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        </section>
      ))}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Saved tolerances become the baseline for the next run. The Run Console can override them
        for a single run without changing this profile, so experimenting there cannot quietly
        alter what every later run is graded under.
      </p>
    </div>
  )
}
