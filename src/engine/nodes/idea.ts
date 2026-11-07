// The Idée stage of the avatar pipeline (docs/specs/pipeline-avatar.md §2.1):
// - `idea.brief@1` takes the project's idea (a title, a short brief) and passes it on as the brief the script reads, in the
//   brief's Markdown shape (the working title in its section 2, so the topic is found the same way as a researched brief);
// - `idea.support@1` reads the support videos (at most `supportMax`) through the eyes and keeps, per video, its tag
//   (« sujet » / « structure »), a summary, the hook and the parts: never the transcript. A video that cannot be read is
//   dropped with a note; the idea alone is enough to continue. The eyes' analysis is already a summary, so no second model
//   pass is made (production-4 decision). Fake: a deterministic reading per URL.
import { z } from 'zod'
import { EngineError, isAbortError } from '../errors'
import { parseSupportList, type Support, type SupportVideo } from '../formats/support'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need, type VideoReading } from '../services'
import type { Json } from '../types'
import { hashOf, progress, readText, throwIfAborted } from './common'

const BriefParams = z.object({ language: z.string().min(2).default('fr') })
type BriefParams = z.infer<typeof BriefParams>

const HEAD = {
  fr: { title: 'Idée', working: 'Titre de travail', brief: 'Brief', none: 'Pas de brief : le titre seul porte l’idée.' },
  en: { title: 'Idea', working: 'Working title', brief: 'Brief', none: 'No brief: the title alone carries the idea.' }
}

/** The brief of an idea: `# Idée`, `## 1. Brief`, `## 2. Titre de travail`. */
export function ideaBrief(title: string, brief: string, language: string): string {
  const h = language === 'fr' ? HEAD.fr : HEAD.en
  return [`# ${h.title}`, `## 1. ${h.brief}`, brief.trim() || h.none, `## 2. ${h.working}`, title.trim()].join('\n\n')
}

export const ideaBriefNode = defineNode<BriefParams>({
  type: 'idea.brief@1',
  inputs: {
    title: { type: 'text.input', required: true, label: 'Titre (l’idée)' },
    brief: { type: 'text.input', required: false, label: 'Brief' }
  },
  outputs: { brief: 'text.brief' },
  params: BriefParams,
  executors: ['local'],
  estimate: () => ({ units: [], durationS: 1 }),
  run(_ctx, inputs, p) {
    const title = readText(inputs.title, 'The title').trim()
    if (!title) throw new EngineError('bad_input', 'Donne un titre à la vidéo : c’est l’idée.')
    const brief = typeof inputs.brief?.value === 'string' ? inputs.brief.value : ''
    return Promise.resolve({ brief: { value: ideaBrief(title, brief, p.language), meta: { title, language: p.language, source: 'idea' } } })
  },
  fake(ctx, inputs, p) {
    return this.run(ctx, inputs, p)
  }
})

const SupportParams = z.object({
  language: z.string().min(2).default('fr'),
  supportMax: z.number().int().min(0).max(10).default(3),
  /** Minutes of each video the eyes watch (the Cloud bills per minute watched). */
  watchMinutes: z.number().min(1).max(30).default(15)
})
type SupportParams = z.infer<typeof SupportParams>

const round2 = (x: number): number => Math.round(x * 100) / 100

/** A reading of the eyes as one support video (the parts become shares of the length). */
export function supportVideo(url: string, tag: SupportVideo['tag'], r: VideoReading): SupportVideo {
  const total = r.durationS > 0 ? r.durationS : Math.max(1, ...r.parts.map((x) => x.toS))
  return {
    url,
    tag,
    title: r.title.slice(0, 300),
    summary: r.summary.slice(0, 2000),
    hook: { text: r.hook.text.slice(0, 600), technique: r.hook.technique.slice(0, 200), seconds: Math.max(0, r.hook.endsAtS) },
    parts: r.parts.slice(0, 40).map((x) => ({ kind: x.kind.slice(0, 30), summary: x.summary.slice(0, 400), share: round2(Math.min(1, Math.max(0, (x.toS - x.fromS) / total))) })),
    durationS: total,
    demo: r.demo
  }
}

const FAKE_SHAPES = [
  ['hook', 'intro', 'body', 'body', 'body', 'cta', 'outro'],
  ['hook', 'body', 'body', 'transition', 'body', 'outro'],
  ['hook', 'intro', 'body', 'body', 'cta', 'body', 'outro']
] as const

/** A deterministic reading of a URL (demo runs): its title, summary and parts depend on the URL only. */
export function fakeReading(url: string, language: string): VideoReading {
  const h = parseInt(hashOf(url).slice(0, 8), 16)
  const kinds = FAKE_SHAPES[h % FAKE_SHAPES.length] ?? FAKE_SHAPES[0]
  const durationS = 600 + (h % 9) * 60
  const n = (h % 7) + 3
  const fr = language === 'fr'
  const slot = durationS / kinds.length
  return {
    title: fr ? `${n} erreurs que tout le monde fait (vidéo ${(h % 900) + 100})` : `${n} mistakes everyone makes (video ${(h % 900) + 100})`,
    summary: fr
      ? `La vidéo passe en revue ${n} erreurs courantes, explique pourquoi elles coûtent cher et donne l’ancienne méthode qui marche.`
      : `The video goes through ${n} common mistakes, explains why they cost money and gives the old way that works.`,
    hook: { text: fr ? `Vous faites sûrement l’erreur numéro ${n}.` : `You are probably making mistake number ${n}.`, endsAtS: 12 + (h % 10), technique: fr ? 'erreur coûteuse' : 'costly mistake' },
    parts: kinds.map((kind, i) => ({ kind, fromS: Math.round(i * slot), toS: Math.round((i + 1) * slot), summary: fr ? `Partie ${i + 1} : ${kind}` : `Part ${i + 1}: ${kind}` })),
    durationS,
    demo: true
  }
}

async function readAll(list: { url: string; tag: SupportVideo['tag'] }[], read: (url: string) => Promise<VideoReading>, ctx: RunCtx): Promise<Support> {
  const videos: SupportVideo[] = []
  const dropped: Support['dropped'] = []
  for (const [i, item] of list.entries()) {
    throwIfAborted(ctx)
    progress(ctx, i, list.length, `Lecture de la vidéo d’appui ${i + 1} sur ${list.length}…`)
    try {
      videos.push(supportVideo(item.url, item.tag, await read(item.url)))
    } catch (e) {
      if (isAbortError(e)) throw e
      dropped.push({ url: item.url, reason: `illisible : ${e instanceof Error ? e.message.slice(0, 200) : 'erreur inconnue'}` })
    }
  }
  return { videos, dropped }
}

function listOf(inputs: ResolvedInputs, max: number): { list: { url: string; tag: SupportVideo['tag'] }[]; over: string[] } {
  const raw = typeof inputs.videos?.value === 'string' ? inputs.videos.value : ''
  const all = parseSupportList(raw)
  return { list: all.slice(0, max), over: all.slice(max).map((x) => x.url) }
}

const outputs = (s: Support, over: string[]) => {
  const dropped = [...s.dropped, ...over.map((url) => ({ url, reason: 'au-delà du nombre de vidéos d’appui' }))]
  return {
    support: {
      value: { videos: s.videos, dropped } as unknown as Json,
      meta: { subject: s.videos.filter((v) => v.tag === 'subject').length, structure: s.videos.filter((v) => v.tag === 'structure').length, dropped: dropped.length }
    }
  }
}

export const ideaSupport = defineNode<SupportParams>({
  type: 'idea.support@1',
  inputs: { videos: { type: 'text.input', required: false, label: 'Vidéos d’appui (sujet : / structure : lien)' } },
  outputs: { support: 'json.support' },
  params: SupportParams,
  executors: ['local'],
  // the eyes bill the minutes they watch (Cloud usage `analyseVideo`, not video generation): at most `watchMinutes` of each video
  // the launch lists (at most `supportMax` of them), none when it lists none; a shorter video costs less, so this is an upper bound
  estimate: (ctx, p) => {
    const raw = ctx.inputs.videos?.value
    const n = Math.min(p.supportMax, parseSupportList(typeof raw === 'string' ? raw : '').length)
    return { units: n > 0 ? [{ unit: 'watch_min', qty: n * p.watchMinutes }] : [], provider: 'cloud', durationS: n > 0 ? 30 + n * 40 : 1 }
  },
  async run(ctx, inputs, p) {
    const { list, over } = listOf(inputs, p.supportMax)
    if (list.length === 0) return outputs({ videos: [], dropped: [] }, over)
    const eyes = need(ctx, 'videos')
    const s = await readAll(list, (url) => eyes.read({ url, minutes: p.watchMinutes, language: p.language }, ctx.signal), ctx)
    return outputs(s, over)
  },
  async fake(ctx, inputs, p) {
    const { list, over } = listOf(inputs, p.supportMax)
    const s = await readAll(list, (url) => Promise.resolve(fakeReading(url, p.language)), ctx)
    return outputs(s, over)
  }
})
