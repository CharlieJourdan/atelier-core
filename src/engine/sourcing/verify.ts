// The last check before a clip goes in the film: a contact sheet (3 frames per clip, one row per clip, at most 6 clips) is read by Claude, which
// answers per clip keep / replace / drop with the kind of problem it sees: wrong person, place or era for what the words claim, burnt-in
// text or captions, a logo or watermark, a fake (AI-looking or a compilation edit), or a broken clip (black, frozen, unreadable). A clip with
// no verdict (an unreadable answer) is NOT kept: a failed check never passes a clip silently.
import path from 'node:path'
import { buildSheet, clipFrames } from './sheet.ts'
import type { AskClaude } from './rank.ts'
import type { RunFn } from './types.ts'

export const PROBLEMS = ['none', 'person', 'place', 'era', 'topic', 'text', 'logo', 'fake', 'broken'] as const
export type Problem = (typeof PROBLEMS)[number]
export type VerdictKind = 'keep' | 'replace' | 'drop'

export interface ClipClaim {
  id: string
  /** What the beat wants here, and what the researcher believes the clip shows. */
  need: string
  spoken?: string
  person?: string
  era?: string
  place?: string
}

export interface Verdict {
  id: string
  verdict: VerdictKind
  problem: Problem
  note: string
}

export const VERIFY_BATCH = 6

const SYSTEM =
  'You are the quality checker of a documentary. The attached contact sheet has one ROW of 3 frames per clip (start, middle, end), the rows numbered 1, 2, 3… in the order of the clips listed below. ' +
  'For each clip decide: keep (it shows what the words claim and is clean), replace (usable footage but wrong for this beat: another person, place, era or topic), or drop (unusable: burnt-in text or captions, a visible logo or watermark, an AI-generated or edited-compilation look, or broken: black, frozen, unreadable).\n' +
  'problem is one of: none, person, place, era, topic, text, logo, fake, broken. Judge only what you SEE. A named person must be recognisable from the picture or a caption in it; if you cannot tell, say problem person and replace. ' +
  'Check the era from clothes, vehicles, film grain and buildings. Never accept something because it looks plausible.\n' +
  'Answer ONLY with JSON: {"verdicts":[{"clip":"<clip id>","verdict":"keep|replace|drop","problem":"none|person|place|era|topic|text|logo|fake|broken","note":"<one short sentence>"}]}'

export function verifyPrompt(clips: readonly ClipClaim[]): string {
  return clips
    .map((c, i) => `Row ${i + 1} = clip ${c.id}: wanted « ${c.need} »${c.spoken ? `; spoken: « ${c.spoken} »` : ''}${c.person ? `; person: ${c.person}` : ''}${c.era ? `; era: ${c.era}` : ''}${c.place ? `; place: ${c.place}` : ''}`)
    .join('\n')
}

export function parseVerdicts(text: string, clips: readonly ClipClaim[]): Verdict[] {
  const byId = new Map<string, Record<string, unknown>>()
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { verdicts?: unknown }
    for (const r of Array.isArray(parsed.verdicts) ? parsed.verdicts : []) if (r && typeof r === 'object' && typeof (r as { clip?: unknown }).clip === 'string') byId.set((r as { clip: string }).clip, r as Record<string, unknown>)
  } catch {
    // unreadable: every clip is dropped below
  }
  return clips.map((c): Verdict => {
    const r = byId.get(c.id)
    const verdict: VerdictKind | undefined = r?.verdict === 'keep' || r?.verdict === 'replace' || r?.verdict === 'drop' ? r.verdict : undefined
    if (!r || !verdict) return { id: c.id, verdict: 'drop', problem: 'broken', note: 'no readable verdict: not kept' }
    const problem = PROBLEMS.find((p) => p === r.problem) ?? (verdict === 'keep' ? 'none' : 'topic')
    return { id: c.id, verdict, problem: verdict === 'keep' ? 'none' : problem === 'none' ? 'topic' : problem, note: typeof r.note === 'string' ? r.note.slice(0, 200) : '' }
  })
}

export interface ClipToCheck extends ClipClaim {
  /** The cut clip file and its length. */
  file: string
  durationS: number
}

/** Builds the sheet of up to 6 clips and asks Claude. Returns verdicts in the clips' order. */
export async function verifyClips(clips: readonly ClipToCheck[], claude: AskClaude, run: RunFn, workDir: string, o: { tier?: 'best' | 'balanced' | 'fast'; signal?: AbortSignal } = {}): Promise<{ verdicts: Verdict[]; calls: number }> {
  const verdicts: Verdict[] = []
  let calls = 0
  for (let i = 0; i < clips.length; i += VERIFY_BATCH) {
    const slice = clips.slice(i, i + VERIFY_BATCH)
    const frames: string[] = []
    const labels: string[] = []
    for (const [k, c] of slice.entries()) {
      const fs = await clipFrames(c.file, c.durationS, path.join(workDir, 'frames'), `c${i + k}`, run)
      frames.push(...fs)
      labels.push(...fs.map((_, j) => `${k + 1}.${j + 1}`))
    }
    const sheet = await buildSheet(frames, path.join(workDir, `verify-${i / VERIFY_BATCH}.jpg`), run, { cols: 3, cellW: 400, cellH: 225, labels })
    let text = ''
    calls++
    try {
      text = (await claude.ask({ role: 'media-verifier', tier: o.tier ?? 'balanced', system: SYSTEM, prompt: verifyPrompt(slice), json: true, images: [sheet], signal: o.signal ?? new AbortController().signal })).text
    } catch (e) {
      if (o.signal?.aborted) throw e
    }
    verdicts.push(...parseVerdicts(text, slice))
  }
  return { verdicts, calls }
}
