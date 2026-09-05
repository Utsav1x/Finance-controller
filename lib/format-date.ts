/**
 * Dates in reconciliation are business dates, not instants.
 *
 * A settlement "on the 12th" and a bank credit "on the 12th" are the same day
 * even though the underlying timestamps are hours apart, and a payout settled
 * on a Friday legitimately lands on the Monday. Every comparison in the engine
 * therefore runs on a plain `YYYY-MM-DD` day key plus a business-day count —
 * never on millisecond arithmetic, which would make every weekend look like a
 * two-day variance.
 */

/** `2026-08-12T18:30:00Z` → `2026-08-12`. */
export function dayKey(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return d.toISOString().slice(0, 10)
}

/** Calendar days between two day keys (b − a). Signed. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** Saturday or Sunday. Bank holidays are layered on top via HOLIDAYS. */
export function isWeekend(key: string): boolean {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/**
 * Indian banking holidays that fall inside the demo window. Kept explicit and
 * small rather than pulled from a package: the generator and the engine must
 * agree on exactly this list, and a silent disagreement between them would show
 * up as a phantom timing exception nobody could explain.
 */
export const HOLIDAYS = new Set([
  '2026-08-15', // Independence Day
  '2026-08-26', // Ganesh Chaturthi
  '2026-10-02', // Gandhi Jayanti
  '2026-10-20', // Diwali
])

export function isBusinessDay(key: string): boolean {
  return !isWeekend(key) && !HOLIDAYS.has(key)
}

/** Advance `n` business days from a day key. */
export function addBusinessDays(key: string, n: number): string {
  let current = key
  let remaining = n
  while (remaining > 0) {
    current = addDays(current, 1)
    if (isBusinessDay(current)) remaining--
  }
  return current
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Business days between two keys. This is the unit the date window is expressed
 * in, so that a T+2 rule means the same thing on a Tuesday and on a Friday.
 */
export function businessDaysBetween(a: string, b: string): number {
  if (a === b) return 0
  const forward = daysBetween(a, b) > 0
  const [from, to] = forward ? [a, b] : [b, a]

  let count = 0
  let current = from
  while (current < to) {
    current = addDays(current, 1)
    if (isBusinessDay(current)) count++
  }
  return forward ? count : -count
}

/** `2026-08-12` → `12 Aug 2026`. */
export function formatDay(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** `2026-08-12` → `12 Aug`. For dense tables. */
export function formatDayShort(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Relative label for run timestamps: `just now`, `4m ago`, `2h ago`. */
export function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDay(iso.slice(0, 10))
}

/** `1432` ms → `1.43s`; `840` ms → `840ms`. For throughput readouts. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}
