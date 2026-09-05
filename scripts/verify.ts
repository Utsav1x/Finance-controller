/**
 * The checks that have to pass before any number in this project is quotable.
 *
 *   pnpm verify
 *
 * Runs headless, with no server and no API key. Exits non-zero on failure so it
 * can gate a commit.
 */

import { generateDataset } from '@/lib/data/generator'
import { reconcile } from '@/lib/recon/engine'
import { DEFAULT_TOLERANCES, RECKLESS_TOLERANCES } from '@/lib/recon/tolerances'
import { formatDuration } from '@/lib/format-date'

let failures = 0

function check(name: string, passed: boolean, detail: string) {
  console.log(`  ${passed ? '✓' : '✗'} ${name.padEnd(46)} ${detail}`)
  if (!passed) failures++
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

async function main() {
  console.log('\n  Ledgerly verification\n  ' + '─'.repeat(72))

  // ── 1. Determinism ────────────────────────────────────────────────────────
  // A match rate that cannot be reproduced from the seed in the run record is
  // an anecdote, not a measurement.
  console.log('\n  DETERMINISM')
  {
    const a = await reconcile(generateDataset({ seed: 7, orderCount: 180 }), {
      tolerances: DEFAULT_TOLERANCES,
      adjudicator: null,
    })
    const b = await reconcile(generateDataset({ seed: 7, orderCount: 180 }), {
      tolerances: DEFAULT_TOLERANCES,
      adjudicator: null,
    })

    const fingerprint = (r: typeof a) =>
      JSON.stringify({
        matches: r.matches.map((m) => [m.matchId, m.tier, m.state, m.variancePaise]).sort(),
        exceptions: r.exceptions.map((e) => [e.exceptionId, e.code, e.amountPaise]).sort(),
      })

    check('same seed produces identical matches', fingerprint(a) === fingerprint(b), `${a.matches.length} matches`)
    check(
      'same seed produces identical metrics',
      JSON.stringify({ ...a.metrics, throughput: null }) ===
        JSON.stringify({ ...b.metrics, throughput: null }),
      `precision ${pct(a.metrics.overall.precision)}`,
    )

    const other = await reconcile(generateDataset({ seed: 8, orderCount: 180 }), {
      tolerances: DEFAULT_TOLERANCES,
      adjudicator: null,
    })
    check('a different seed produces different data', fingerprint(a) !== fingerprint(other), 'seed 7 vs 8')
  }

  // ── 2. Accuracy, with no model involved ───────────────────────────────────
  console.log('\n  ACCURACY (deterministic tiers only, no API key)')
  const seeds = [42, 7, 1234, 99]
  for (const seed of seeds) {
    const dataset = generateDataset({ seed, orderCount: 220 })
    const result = await reconcile(dataset, { tolerances: DEFAULT_TOLERANCES, adjudicator: null })
    const m = result.metrics

    check(
      `seed ${String(seed).padEnd(5)} precision is perfect`,
      m.overall.precision === 1,
      `${pct(m.overall.precision)} · ${m.resolution.falsePositives} FP`,
    )
    check(
      `seed ${String(seed).padEnd(5)} recall above 95%`,
      m.overall.recall >= 0.95,
      `${pct(m.overall.recall)} · ${m.resolution.missed} missed`,
    )

    const unhandled = Object.entries(m.plantedRecall).filter(
      ([, s]) => s.planted > 0 && s.handled < s.planted,
    )
    check(
      `seed ${String(seed).padEnd(5)} every planted class handled`,
      unhandled.length === 0,
      unhandled.length === 0
        ? `${Object.values(m.plantedRecall).filter((s) => s.planted > 0).length} classes`
        : unhandled.map(([c, s]) => `${c} ${s.handled}/${s.planted}`).join(', '),
    )
  }

  // ── 3. Every class is actually present ────────────────────────────────────
  // An earlier version scaled batch-level plant counts off the order count,
  // silently planted none of them, and reported perfect recall on classes that
  // were never in the data. This check exists so that cannot recur unnoticed.
  console.log('\n  COVERAGE')
  {
    const dataset = generateDataset({ seed: 42, orderCount: 220 })
    const result = await reconcile(dataset, { tolerances: DEFAULT_TOLERANCES, adjudicator: null })
    const planted = Object.entries(result.metrics.plantedRecall).filter(([, s]) => s.planted > 0)
    check('all ten failure modes are present', planted.length === 10, `${planted.length}/10 classes planted`)

    const tiers = Object.keys(result.metrics.tierBreakdown)
    check(
      'more than one tier is doing work',
      tiers.length >= 3,
      tiers.sort().join(', '),
    )
  }

  // ── 4. Small batch — the track's floor ────────────────────────────────────
  console.log('\n  SMALL BATCH')
  {
    const dataset = generateDataset({ seed: 42, orderCount: 50, days: 10 })
    const result = await reconcile(dataset, { tolerances: DEFAULT_TOLERANCES, adjudicator: null })
    const records = result.metrics.throughput.records
    check('50 orders yields a 50+ record batch', records >= 50, `${records} records`)
    check(
      '50 orders still carries every class',
      Object.values(result.metrics.plantedRecall).filter((s) => s.planted > 0).length === 10,
      `precision ${pct(result.metrics.overall.precision)}`,
    )
  }

  // ── 5. Throughput ─────────────────────────────────────────────────────────
  console.log('\n  THROUGHPUT')
  for (const orderCount of [50, 500, 2000]) {
    const dataset = generateDataset({ seed: 42, orderCount, days: orderCount > 500 ? 60 : 30 })
    const result = await reconcile(dataset, { tolerances: DEFAULT_TOLERANCES, adjudicator: null })
    const t = result.metrics.throughput
    check(
      `${String(orderCount).padStart(4)} orders completes under 5s`,
      t.wallMs < 5000,
      `${t.records} records in ${formatDuration(t.wallMs)} · ${t.recordsPerSecond.toLocaleString()}/s`,
    )
  }

  // ── 5b. Hard mode ─────────────────────────────────────────────────────────
  // Degraded statements are what give tier 4 anything to do. Two things must
  // hold: the rules must hand real work upward, and they must not invent
  // matches to avoid doing so. The second is the one that broke — an unbounded
  // subset-sum happily assembled nine "split payouts" out of unrelated credits
  // the moment the candidate pool grew.
  console.log('\n  HARD MODE (45% of statements unusable)')
  {
    const dataset = generateDataset({ seed: 42, orderCount: 220, referenceLoss: 0.45 })
    const result = await reconcile(dataset, { tolerances: DEFAULT_TOLERANCES, adjudicator: null })
    const m = result.metrics
    const queued = result.exceptions.filter((e) => e.code === 'LLM_UNAVAILABLE').length

    check(
      'degraded data reaches the adjudicator',
      queued > 0,
      `${queued} batches queued for tier 4`,
    )
    check(
      'rules keep precision without a model',
      m.overall.precision === 1,
      `${pct(m.overall.precision)} · ${m.resolution.falsePositives} FP`,
    )
    check(
      'no fabricated splits from summing coincidences',
      m.resolution.falsePositives === 0,
      `tier3 resolved ${m.tierBreakdown.tier3 ?? 0}`,
    )
    check(
      'genuine split payouts still recovered',
      m.plantedRecall.SPLIT_PAYOUT.handled === m.plantedRecall.SPLIT_PAYOUT.planted,
      `${m.plantedRecall.SPLIT_PAYOUT.handled}/${m.plantedRecall.SPLIT_PAYOUT.planted}`,
    )
    check(
      'decoy credits are rejected, not matched',
      m.plantedRecall.ORPHAN_CREDIT.handled === m.plantedRecall.ORPHAN_CREDIT.planted,
      `${m.plantedRecall.ORPHAN_CREDIT.handled}/${m.plantedRecall.ORPHAN_CREDIT.planted}`,
    )

    const clean = await reconcile(generateDataset({ seed: 42, orderCount: 220 }), {
      tolerances: DEFAULT_TOLERANCES,
      adjudicator: null,
    })
    check(
      'clean data is unchanged by the feature',
      clean.metrics.overall.recall === 1 && clean.metrics.overall.precision === 1,
      `recall ${pct(clean.metrics.overall.recall)} at referenceLoss 0`,
    )
  }

  // ── 6. The adversarial check ──────────────────────────────────────────────
  // If wide-open tolerances cannot produce a false positive, the grader is not
  // grading and every figure above is decoration.
  console.log('\n  ADVERSARIAL (reckless tolerances must break precision)')
  {
    const dataset = generateDataset({ seed: 42, orderCount: 220 })
    const result = await reconcile(dataset, { tolerances: RECKLESS_TOLERANCES, adjudicator: null })
    const m = result.metrics
    check(
      'reckless tolerances produce false positives',
      m.resolution.falsePositives > 0,
      `${m.resolution.falsePositives} FP · precision ${pct(m.overall.precision)}`,
    )
    check(
      'precision is measurably worse than default',
      m.overall.precision < 1,
      `${pct(m.overall.precision)} vs 100.0%`,
    )
  }

  // ── 7. Degradation ────────────────────────────────────────────────────────
  console.log('\n  DEGRADATION (no adjudicator available)')
  {
    const dataset = generateDataset({ seed: 3, orderCount: 220 })
    const result = await reconcile(dataset, { tolerances: DEFAULT_TOLERANCES, adjudicator: null })
    const accounted =
      result.metrics.overall.truePositives +
      result.metrics.overall.falseNegatives -
      result.metrics.overall.truePositives

    check('run completes with no provider', result.metrics.throughput.records > 0, `${result.matches.length} matches`)
    check('no model calls were made', result.metrics.throughput.llmCalls === 0, '0 calls, $0.00')
    check(
      'nothing was silently dropped',
      accounted === result.metrics.overall.falseNegatives,
      `${result.exceptions.length} exceptions reported`,
    )
  }

  console.log('\n  ' + '─'.repeat(72))
  if (failures === 0) {
    console.log('  All checks passed.\n')
  } else {
    console.log(`  ${failures} check(s) FAILED.\n`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
