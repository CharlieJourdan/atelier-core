// The media choice is an agent's job (decision 0069 update, Charlie 2026-11-02): a Claude agent on the user's subscription looks at what is
// actually available for a beat (the candidates `searchMedia` found, with their text and, when given, a contact sheet picture) and picks the
// one that fits the spoken words best, or says that nothing fits (a real gap: only then is a picture generated). The rules are the
// documentary's: a literal beat gets the very thing it names; an illustrative one gets a real, concrete thing of the right place and era;
// a person appears only if the candidate's own text names them; never another place, era or event just because it looks right.
// Up to 6 beats per call. The answer is read defensively: an unreadable or out-of-range answer means « no pick », never a wrong one.
import type { AskClaude } from './rank.ts'
import type { Need } from './needs.ts'
import type { MediaCandidate } from './types.ts'

export interface PickItem {
  id: string
  /** The words spoken over this shot. */
  spoken: string
  need?: Need
  candidates: readonly MediaCandidate[]
  /** A contact sheet picture of the candidates (tile numbers = candidate numbers, from 1). */
  sheet?: string
}

export type PickMatch = 'literal' | 'illustrative' | 'none'

export interface Pick {
  id: string
  /** The chosen candidate, or null when nothing fits. */
  choice: MediaCandidate | null
  /** Other acceptable candidates, best first. */
  backups: MediaCandidate[]
  match: PickMatch
  why: string
}

export const PICK_BATCH = 6
export const PICK_MAX_CANDIDATES = 10

const SYSTEM =
  'You are the picture editor of a documentary. For each numbered item you get the words spoken over a shot, what the researcher wants there, and numbered candidates found in archives, stock libraries and footage (title, date, creator, source, kind, licence, text). ' +
  'Choose the ONE candidate that shows best what the words say, or 0 if none fits.\n' +
  'Rules: (1) a candidate that shows the very thing, place, person or event the words name beats one that merely illustrates it; an illustrative candidate beats a generic one. ' +
  '(2) Show a named person only if the candidate’s own title or text names that person. (3) Never accept another place, era or event because it looks right: a wrong 1960s for a 1940s beat is a failure; say 0 instead. ' +
  '(4) Prefer real archive material to modern reconstructions when the beat is historical, and a candidate whose licence needs no review when two fit equally. ' +
  '(5) If a contact sheet picture is attached for an item, the tile numbers are the candidate numbers: use what you SEE, and drop a candidate whose picture contradicts its title. ' +
  '(6) A generic subject the words do not talk about is not illustrative: soldiers, crowds, snow or ruins under a sentence about something else, a body cropped without its face, a picture with a watermark or a channel logo: say 0.\n' +
  'Answer ONLY with JSON: {"picks":[{"item":"<item id>","pick":<candidate number or 0>,"backups":[<numbers>],"match":"literal|illustrative|none","why":"<one short sentence>"}]}'

function describe(c: MediaCandidate, n: number): string {
  const bits = [c.kind, c.provider, c.date, c.creator, c.durationS ? `${Math.round(c.durationS)} s` : '', c.licence.status, c.review === 'human-review' ? 'needs review' : ''].filter(Boolean)
  const tags = c.tags?.length ? ` {${c.tags.slice(0, 5).join(', ')}}` : ''
  return `${n}. ${c.title.slice(0, 140)} [${bits.join(' · ')}]${c.description ? ` — ${c.description.slice(0, 180)}` : ''}${tags}`
}

export function pickPrompt(items: readonly PickItem[]): string {
  return items
    .map((it) => {
      const list = it.candidates.slice(0, PICK_MAX_CANDIDATES).map((c, i) => describe(c, i + 1))
      const need = it.need ? `\nThe researcher wants (${it.need.mode}): ${it.need.need}${it.need.person ? ` — person: ${it.need.person}` : ''}${it.need.era ? ` — era: ${it.need.era}` : ''}` : ''
      return `ITEM ${it.id}\nSpoken: ${it.spoken}${need}\nCandidates:\n${list.length ? list.join('\n') : '(none found)'}`
    })
    .join('\n\n')
}

export function parsePicks(text: string, items: readonly PickItem[]): Pick[] {
  const byItem = new Map<string, Record<string, unknown>>()
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { picks?: unknown }
    for (const r of Array.isArray(parsed.picks) ? parsed.picks : []) if (r && typeof r === 'object' && typeof (r as { item?: unknown }).item === 'string') byItem.set((r as { item: string }).item, r as Record<string, unknown>)
  } catch {
    // unreadable: every item gets « no pick »
  }
  return items.map((it): Pick => {
    const cands = it.candidates.slice(0, PICK_MAX_CANDIDATES)
    const r = byItem.get(it.id)
    const num = (v: unknown): MediaCandidate | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= cands.length ? cands[v - 1] : undefined)
    const choice = r ? (num(r.pick) ?? null) : null
    const backups = (Array.isArray(r?.backups) ? (r!.backups as unknown[]) : []).map(num).filter((c): c is MediaCandidate => c !== undefined && c !== choice).slice(0, 3)
    const match: PickMatch = !choice ? 'none' : r?.match === 'literal' ? 'literal' : 'illustrative'
    return { id: it.id, choice, backups, match, why: typeof r?.why === 'string' ? r.why.slice(0, 200) : r ? '' : 'no answer for this item' }
  })
}

export interface PickOptions {
  tier?: 'best' | 'balanced' | 'fast'
  batch?: number
  signal?: AbortSignal
}

/** One Claude call per ≤ 6 items. Returns the picks in the items' order, and how many calls were made. */
export async function pickMedia(items: readonly PickItem[], claude: AskClaude, o: PickOptions = {}): Promise<{ picks: Pick[]; calls: number }> {
  const size = Math.max(1, o.batch ?? PICK_BATCH)
  const picks: Pick[] = []
  let calls = 0
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size)
    if (slice.every((it) => it.candidates.length === 0)) {
      picks.push(...parsePicks('', slice))
      continue
    }
    const images = slice.map((it) => it.sheet).filter((s): s is string => !!s)
    calls++
    let text = ''
    try {
      text = (
        await claude.ask({
          role: 'media-picker',
          tier: o.tier ?? 'balanced',
          system: SYSTEM,
          prompt: (images.length ? `Attached pictures, in order, are the contact sheets of the items that have one (${slice.filter((it) => it.sheet).map((it) => it.id).join(', ')}).\n\n` : '') + pickPrompt(slice),
          json: true,
          ...(images.length ? { images } : {}),
          signal: o.signal ?? new AbortController().signal
        })
      ).text
    } catch (e) {
      if (o.signal?.aborted) throw e
    }
    picks.push(...parsePicks(text, slice))
  }
  return { picks, calls }
}
