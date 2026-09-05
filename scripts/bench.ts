/**
 * Headless benchmark. No server, no key, no UI.
 *
 *   pnpm bench                 # default profile
 *   pnpm bench -- 500          # 500 orders
 *   pnpm bench -- 200 reckless # the adversarial tolerance profile
 *
 * This is the number the scorecard shows, produced without anything that could
 * flatter it. If the two ever disagree, this one is right.
 */

import { generateDataset, plantedSummary } from '@/lib/data/generator'
import { reconcile } from '@/lib/recon/engine'
import { DEFAULT_TOLERANCES, RECKLESS_TOLERANCES } from '@/lib/recon/tolerances'
import { formatMoney } from '@/lib/format-money'
import { formatDuration } from '@/lib/format-date'

const args = process.argv.slice(2)
const orderCount = Number(args.find((a) => /^\d+$/.test(a)) ?? 220)
const reckless = args.includes('reckless')
const seed = Number(args.find((a) => a.startsWith('seed='))?.split('=')[1] ?? 42)
/** `ref=0.4` — hard mode. Fraction of payouts stripped of their reference and delayed. */
const referenceLoss = Number(args.find((a) => a.startsWith('ref='))?.split('=')[1] ?? 0)

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const pad = (s: string, n: number) => s.padEnd(n)

async function main() {
  const dataset = generateDataset({ seed, orderCount, referenceLoss })
  const tolerances = reckless ? RECKLESS_TOLERANCES : DEFAULT_TOLERANCES

  const result = await reconcile(dataset, { tolerances, adjudicator: null })
  const m = result.metrics

  console.log('')
  console.log(
    `  Ledgerly bench — seed ${seed}, ${orderCount} orders${reckless ? ', RECKLESS tolerances' : ''}${referenceLoss > 0 ? `, ${(referenceLoss * 100).toFixed(0)}% reference loss` : ''}`,
  )
  console.log(`  ${'─'.repeat(66)}`)
  console.log(`  sources        ${dataset.orders.length} orders · ${dataset.settlements.length} settlement lines · ${dataset.bankLines.length} bank lines`)
  console.log(`  records        ${m.throughput.records} in ${formatDuration(m.throughput.wallMs)}  (${m.throughput.recordsPerSecond.toLocaleString()}/s)`)
  console.log('')

  console.log('  ACCURACY (graded against ground truth)')
  console.log(`    ${pad('level', 8)} ${pad('precision', 11)} ${pad('recall', 9)} ${pad('F1', 8)} TP / FP / FN`)
  for (const [label, lm] of [['L1', m.l1], ['L2', m.l2], ['all', m.overall]] as const) {
    console.log(
      `    ${pad(label, 8)} ${pad(pct(lm.precision), 11)} ${pad(pct(lm.recall), 9)} ${pad(lm.f1.toFixed(3), 8)} ${lm.truePositives} / ${lm.falsePositives} / ${lm.falseNegatives}`,
    )
  }
  console.log('')

  console.log('  RESOLUTION')
  console.log(`    auto-matched   ${m.resolution.autoMatched}/${m.resolution.totalPairs}  (${pct(m.resolution.autoMatchRate)})`)
  console.log(`    to review      ${m.resolution.review}  (${pct(m.resolution.reviewRate)})`)
  console.log(`    missed         ${m.resolution.missed}`)
  console.log(`    FALSE POSITIVE ${m.resolution.falsePositives}`)
  console.log('')

  console.log('  TIER ATTRIBUTION')
  for (const [tier, count] of Object.entries(m.tierBreakdown).sort()) {
    console.log(`    ${pad(tier, 8)} ${count}`)
  }
  console.log('')

  console.log('  PLANTED CLASSES (handled / planted)')
  const planted = plantedSummary(dataset.truth)
  for (const [code, stat] of Object.entries(m.plantedRecall).sort()) {
    if (stat.planted === 0) continue
    const ok = stat.handled === stat.planted
    console.log(
      `    ${ok ? '✓' : '✗'} ${pad(code, 20)} ${stat.handled}/${stat.planted}  ${pct(stat.handled / stat.planted)}`,
    )
  }
  console.log('')

  console.log('  EXCEPTIONS')
  for (const [code, count] of Object.entries(m.exceptionsByCode).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(code, 20)} ${count}`)
  }
  console.log(`    ${pad('value at risk', 20)} ${formatMoney(m.unmatchedValuePaise)}`)
  console.log(`    ${pad('variance found', 20)} ${formatMoney(m.varianceValuePaise)}`)
  console.log('')

  if (reckless && m.resolution.falsePositives === 0) {
    console.log('  !! Reckless tolerances produced zero false positives.')
    console.log('     The grader is not actually grading. Fix that before trusting any number above.')
    process.exitCode = 1
  }

  void planted
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
