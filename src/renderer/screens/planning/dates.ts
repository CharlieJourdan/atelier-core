// Pure date helpers of the planning and the dashboard. The demo fixtures speak in day offsets from today, so everything
// here is real Date math anchored on a `today` that tests can pin.
import { getLocale } from '../../../shared/fr'

export const DAY_MS = 86_400_000

export function localeTag(): string {
  return getLocale() === 'en' ? 'en-GB' : 'fr-FR'
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Whole days from `from` to `to` (calendar days, safe across daylight-saving changes). */
export function diffDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Monday of the week holding `d`. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7
  return addDays(x, -dow)
}

/** "18:00" → minutes since midnight. */
export function minutesOf(time: string): number {
  const [h = '0', m = '0'] = time.split(':')
  return Number(h) * 60 + Number(m)
}

export function timeOf(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** The 6-row (or 5-row) Monday-first grid of days shown for the month holding `anchor`. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(first)
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const rows = Math.ceil((diffDays(start, last) + 1) / 7)
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i))
}

export function fmtWeekdayShort(d: Date): string {
  return d.toLocaleDateString(localeTag(), { weekday: 'short' }).replace('.', '')
}

export function fmtDayMonth(d: Date): string {
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short' })
}

export function fmtLongDay(d: Date): string {
  return d.toLocaleDateString(localeTag(), { weekday: 'long', day: 'numeric', month: 'long' })
}

export function fmtMonthYear(d: Date): string {
  const s = d.toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** « 23 oct. – 29 oct. 2026 » (the formatter collapses the shared parts). */
export function fmtRange(a: Date, b: Date): string {
  return new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(a, b)
}

/** "18:00" → « 18 h », "12:30" → « 12 h 30 » (24 h clock in English). */
export function fmtTime(time: string): string {
  if (getLocale() === 'en') return time
  const [h = '0', m = '0'] = time.split(':')
  return Number(m) === 0 ? `${Number(h)} h` : `${Number(h)} h ${m}`
}
