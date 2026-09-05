/**
 * Money handling for the whole app.
 *
 * Everything downstream of the CSV parser stores amounts as **integer paise**.
 * Floating point is not merely imprecise here, it is wrong in a way that
 * silently manufactures exceptions: a batch of 200 settlement lines summed as
 * floats drifts by a paisa or two, the total misses the bank credit by that
 * drift, and a perfectly good match is reported as an unexplained variance.
 * Integers make the rounding class (exception #8) a property of the *data*
 * rather than an artefact of our arithmetic.
 */

/** Parse a decimal-rupee string or number into integer paise. */
export function toPaise(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100)

  const cleaned = value.replace(/[₹,\s]/g, '').trim()
  if (cleaned === '' || cleaned === '-') return 0

  // Round rather than truncate: '10.005' is 1001 paise, not 1000.
  return Math.round(Number(cleaned) * 100)
}

/** Integer paise back to a plain decimal number of rupees. */
export function toRupees(paise: number): number {
  return paise / 100
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** `12345678` → `₹1,23,456.78`. Indian digit grouping. */
export function formatMoney(paise: number): string {
  return INR.format(paise / 100)
}

/** Same, but always carrying an explicit sign — for deltas and variances. */
export function formatDelta(paise: number): string {
  if (paise === 0) return '₹0.00'
  const sign = paise > 0 ? '+' : '−'
  return `${sign}${INR.format(Math.abs(paise) / 100)}`
}

/** Compact form for stat tiles: `₹4.2L`, `₹1.8Cr`. */
export function formatCompact(paise: number): string {
  const rupees = Math.abs(paise) / 100
  const sign = paise < 0 ? '−' : ''

  if (rupees >= 1_00_00_000) return `${sign}₹${(rupees / 1_00_00_000).toFixed(2)}Cr`
  if (rupees >= 1_00_000) return `${sign}₹${(rupees / 1_00_000).toFixed(2)}L`
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)}k`
  return `${sign}₹${rupees.toFixed(0)}`
}

/**
 * Basis points of difference between two amounts, relative to the larger.
 * The tolerance band is expressed in bps so it scales: 25bps forgives ₹2.50 on
 * a ₹1,000 payout and ₹250 on a ₹1,00,000 one, which is how fee drift actually
 * behaves.
 */
export function deltaBps(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b))
  if (base === 0) return 0
  return Math.abs(a - b) / base * 10_000
}
