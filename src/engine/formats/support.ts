// `json.support` (docs/specs/pipeline-avatar.md §2.1): the support videos of one idea, as the script writer reads them. Each
// video is tagged « sujet » (what to talk about: its summary feeds the content) or « structure » (how to build it: its
// parts and hook feed the outline). Never the transcript itself (a summary, the hook and the parts only), so nothing of
// another channel's wording can reach the script.
import { z } from 'zod'

export const SUPPORT_TAGS = ['subject', 'structure'] as const
export type SupportTag = (typeof SUPPORT_TAGS)[number]

export const SupportPart = z.object({
  /** hook, intro, body, transition, cta, outro (the eyes' segment kinds). */
  kind: z.string().min(1).max(30),
  summary: z.string().max(400),
  /** Share of the video's length (0..1). */
  share: z.number().min(0).max(1)
})
export type SupportPart = z.infer<typeof SupportPart>

export const SupportVideo = z.object({
  url: z.string().min(1).max(500),
  tag: z.enum(SUPPORT_TAGS),
  title: z.string().max(300),
  summary: z.string().max(2000),
  hook: z.object({ text: z.string().max(600), technique: z.string().max(200), seconds: z.number().min(0) }),
  parts: z.array(SupportPart).max(40),
  durationS: z.number().min(0),
  demo: z.boolean().default(false)
})
export type SupportVideo = z.infer<typeof SupportVideo>

export const Support = z.object({
  videos: z.array(SupportVideo).max(10),
  /** Videos that could not be read, with the reason (French, shown on the gate card). */
  dropped: z.array(z.object({ url: z.string(), reason: z.string() })).default([])
})
export type Support = z.infer<typeof Support>

const TAG_WORDS: Record<string, SupportTag> = {
  sujet: 'subject',
  subject: 'subject',
  fond: 'subject',
  structure: 'structure',
  forme: 'structure',
  form: 'structure'
}

/**
 * The support videos a person typed: one per line, `sujet: <url>` or `structure: <url>` (a bare URL is a « sujet »), or a JSON
 * list of `{ url, tag }`. Lines that hold no URL are ignored; the same URL twice keeps the first.
 */
export function parseSupportList(text: string): { url: string; tag: SupportTag }[] {
  const out: { url: string; tag: SupportTag }[] = []
  const add = (url: string, tag: SupportTag): void => {
    if (/^https?:\/\/\S+$/u.test(url) && !out.some((x) => x.url === url)) out.push({ url, tag })
  }
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    try {
      const list: unknown = JSON.parse(trimmed)
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
            const tag = TAG_WORDS[String((item as { tag?: unknown }).tag ?? 'sujet').toLowerCase()] ?? 'subject'
            add((item as { url: string }).url.trim(), tag)
          }
        }
        return out
      }
    } catch {
      // not JSON: read it as lines
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]\s*)?(?:([A-Za-zÀ-ÿ]+)\s*[:=-]\s*)?(https?:\/\/\S+)\s*$/u.exec(line)
    if (!m?.[2]) continue
    add(m[2], TAG_WORDS[(m[1] ?? 'sujet').toLowerCase()] ?? 'subject')
  }
  return out
}

/** The lines of the outline prompt from the « structure » videos (how the parts follow each other, the hook); empty without one. */
export function structureLines(s: Support | undefined): string[] {
  const list = (s?.videos ?? []).filter((v) => v.tag === 'structure')
  if (list.length === 0) return []
  const lines = list.map((v, i) => {
    const parts = v.parts.map((p) => `${p.kind} (${Math.round(p.share * 100)} %): ${p.summary}`).join(' > ')
    return `Structure video ${i + 1} « ${v.title} » (${Math.round(v.durationS / 60)} min). Hook (${v.hook.technique}, ${Math.round(v.hook.seconds)} s). Parts in order: ${parts}`
  })
  return [
    `Support videos tagged « structure »: build the outline on their shape (the order and the weight of the parts, the kind of hook). Copy the shape, never their words or their facts.\n${lines.join('\n')}`
  ]
}

/** The lines of the writing prompts from the « sujet » videos (what to talk about); empty without one. */
export function subjectLines(s: Support | undefined): string[] {
  const list = (s?.videos ?? []).filter((v) => v.tag === 'subject')
  if (list.length === 0) return []
  const lines = list.map((v, i) => `Subject video ${i + 1} « ${v.title} »: ${v.summary}`)
  return [
    `Support videos tagged « sujet »: what the video should cover. Use their points as material to verify and build on, never as wording to reuse.\n${lines.join('\n')}`
  ]
}
