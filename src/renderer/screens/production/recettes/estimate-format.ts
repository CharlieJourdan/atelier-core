// Euros of credits for the estimate views (1 credit = `creditEur` €): two decimals, French style; render times in minutes.
import { t } from '../../../../shared/fr'

const EUR = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Euros of credits, two decimals; a price above zero but under one cent reads « < 0,01 » (never « 0,00 »: issue #97). */
export const eurOf = (credits: number, creditEur: number): string => {
  const eur = credits * creditEur
  return eur > 0 && eur < 0.005 ? '< 0,01' : EUR.format(eur)
}

/** A render time in plain words: `6 min`, `1 h 05` (at least one minute). */
export function durationText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return t('est.time.minutes', { n: minutes })
  return t('est.time.hours', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') })
}

/** `+0,12 €/min`, `−0,05 €/min`, or `+0 €/min` for no change (a change under half a cent is no change). */
export function signedEur(credits: number, creditEur: number): string {
  const eur = credits * creditEur
  if (Math.abs(eur) < 0.005) return '+0 €/min'
  return `${eur > 0 ? '+' : '−'}${EUR.format(Math.abs(eur))} €/min`
}
