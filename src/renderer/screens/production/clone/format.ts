// Small formatters shared by the clone screens (French number style, plain units).
import type { IntakeChange, IntakeField } from '../../../../shared/clone'
import { tc } from '../../../../shared/fr-clone'

export const usd = (x: number): string => (Number.isInteger(x) ? String(x) : x < 1 ? x.toFixed(2) : x.toFixed(1)).replace('.', ',')
export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
export const minutes = (s: number): string => (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`)

const INPUT_LABEL = { face: 'clone.brief.input.face', voice: 'clone.brief.input.voice', footage: 'clone.brief.input.footage' } as const

/** A raw value of the draft in words (`copy-channel` → « Copier une chaîne », `fr` → « français »). */
export function valueText(field: IntakeField, raw: string): string {
  if (raw === '') return tc('clone.brief.empty')
  switch (field) {
    case 'intent': return tc(`clone.intent.${raw}.title`)
    case 'language': case 'sourceLanguage': return tc(`clone.lang.${raw}`) === `clone.lang.${raw}` ? raw : tc(`clone.lang.${raw}`)
    case 'testBudgetUsd': return tc('clone.brief.budget', { usd: usd(Number(raw)) })
    case 'style': return raw === 'auto' ? tc('clone.brief.style.auto') : tc('clone.brief.style.pick', { style: raw })
    case 'humanInputs': return raw === 'none' ? tc('clone.brief.inputs.none') : raw.split(',').map((k) => tc(INPUT_LABEL[k as keyof typeof INPUT_LABEL])).join(', ')
    case 'references': return raw.split(' | ').map((r) => r.replace(/^https?:\/\/(www\.)?/, '')).join(' · ')
    default: return raw
  }
}

export const fieldLabel = (field: IntakeField): string => tc(`clone.brief.field.${field}`)

export function changeText(c: IntakeChange): { field: string; before: string; after: string } {
  return { field: fieldLabel(c.field), before: valueText(c.field, c.before), after: valueText(c.field, c.after) }
}
