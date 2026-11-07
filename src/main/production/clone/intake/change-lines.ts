// P0 — the plain-language line for each change a message made to the draft. Never an internal field name or a raw value
// (`humanInputs`, `copy-channel`, `none`): « Tu ne fournis ni visage ni voix : je mettrai des provisoires. »
import type { IntakeChange, IntakeField } from '../../../../shared/clone'
import { tc } from '../../../../shared/fr-clone'

const INPUT_WORD: Record<string, string> = { face: 'clone.brief.input.face', voice: 'clone.brief.input.voice', footage: 'clone.brief.input.footage' }

const usd = (x: number): string => (Number.isInteger(x) ? String(x) : x < 1 ? x.toFixed(2) : x.toFixed(1)).replace('.', ',')
const list = (items: string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')}${tc('clone.intake.line.and')}${items.at(-1)}`)

/** A raw draft value in words (`copy-channel` → « Copier une chaîne », `fr` → « français », `face,voice` → « ton visage, ta voix »). */
export function plainValue(field: IntakeField, raw: string): string {
  if (raw === '') return tc('clone.brief.empty')
  switch (field) {
    case 'intent': return tc(`clone.intent.${raw}.title`)
    case 'language': case 'sourceLanguage': return tc(`clone.lang.${raw}`) === `clone.lang.${raw}` ? raw : tc(`clone.lang.${raw}`)
    case 'testBudgetUsd': return tc('clone.brief.budget', { usd: usd(Number(raw)) })
    case 'style': return raw === 'auto' ? tc('clone.brief.style.auto') : tc('clone.brief.style.pick', { style: raw })
    case 'references': return raw.split(' | ').map((r) => {
      const m = /^(\S+)(?: \[(.*)\])?$/.exec(r)
      const axes = m?.[2] ? m[2].split(',').map((a) => tc(`clone.axis.${a}`)).join(', ') : ''
      return `${(m?.[1] ?? r).replace(/^https?:\/\/(www\.)?/, '')}${axes ? ` (${axes})` : ''}`
    }).join(' · ')
    default: return raw
  }
}

/** What he supplies, as a sentence (`after` is the draft's `face,voice` list or `none`). */
function inputsLine(after: string): string {
  const given = after === 'none' || after === '' ? [] : after.split(',')
  if (given.length === 0) return tc('clone.intake.line.inputs.none')
  if (given.length >= 3) return tc('clone.intake.line.inputs.all')
  return tc('clone.intake.line.inputs.some', { what: list(given.map((k) => tc(INPUT_WORD[k] ?? k))) })
}

export function changeLine(c: IntakeChange): string {
  if (c.field === 'humanInputs') return inputsLine(c.after)
  const after = plainValue(c.field, c.after)
  const label = tc(`clone.brief.field.${c.field}`)
  return c.before === '' ? tc('clone.intake.line.field', { field: label, after }) : tc('clone.intake.line.fieldFrom', { field: label, after, before: plainValue(c.field, c.before) })
}

export const changeLines = (changes: IntakeChange[]): string[] => changes.map(changeLine)
