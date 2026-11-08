// What each brick of a demo run "produced" (api-runs*.ts), for the review panels, the editor and the library: texts
// written from the run's topic, an edit plan, drawn pictures, synthesised sounds, captions and the upload package. Every
// file is made on demand in the browser (api-runs-media.ts); the final video has no playable file in the demo.
import type { LibraryItem, RunDetail, RunFile, RunFileRef, RunOutput, RunPlanShot, RunWord } from '../../../shared/runs'
import { claimedSize, posterSvg, svgBytes, textBytes, toneWav } from './api-runs-media'
import { revisions } from './api-runs-state'

const BEATS = 6
const en = (run: RunDetail): boolean => run.style.language === 'en'
const portrait = (run: RunDetail): boolean => run.minutes <= 1.5

const SECTIONS_FR = ['L’accroche', 'Le contexte', 'Les faits', 'Les pistes', 'Ce qu’on peut conclure', 'Le mot de la fin']
const SECTIONS_EN = ['The hook', 'The setting', 'The facts', 'The theories', 'What we can conclude', 'Closing words']

function paragraphs(run: RunDetail): string[] {
  const topic = run.topic.replace(/\.$/, '')
  if (en(run))
    return [
      `What if everything you think you know about this story is wrong? ${run.videoTitle}: let’s look at it from the start.`,
      `First, the setting. ${topic}. The sources we can trust are few, and they do not always agree.`,
      `Here is what is documented: the dates, the places, the people involved, and the reports written at the time.`,
      `Then come the theories, from the most reasonable to the most far-fetched. We will weigh each one against the facts.`,
      `Put together, the evidence points to a simpler answer than the legend — less spectacular, but far more solid.`,
      `If you want the next story, it is already waiting. Thanks for watching until the end.`
    ]
  return [
    `Et si tout ce que vous croyez savoir sur cette histoire était faux ? ${run.videoTitle} : reprenons depuis le début.`,
    `D’abord, le contexte. ${topic}. Les sources fiables sont rares, et elles ne disent pas toujours la même chose.`,
    `Voici ce qui est établi : les dates, les lieux, les personnes en cause et les rapports écrits à l’époque.`,
    `Viennent ensuite les hypothèses, de la plus raisonnable à la plus folle. On les confronte une à une aux faits.`,
    `Mis bout à bout, les indices désignent une réponse plus simple que la légende : moins spectaculaire, mais bien plus solide.`,
    `La prochaine histoire vous attend déjà. Merci d’être restés jusqu’au bout.`
  ]
}

/** The script, with one adjusted paragraph per change note the owner sent (`upTo` notes: an earlier version). */
function scriptText(run: RunDetail, upTo?: number): string {
  const notes = (revisions.get(`${run.id}:script`) ?? []).slice(0, upTo)
  const titles = en(run) ? SECTIONS_EN : SECTIONS_FR
  const body = paragraphs(run).map((p, i) => `## ${titles[i] ?? ''}\n${p}`)
  for (const note of notes) body.splice(1, 0, `## ${en(run) ? 'Revised' : 'Repris'}\n${en(run) ? 'Taking your note into account' : 'Avec ta note'} (« ${note} ») : ${en(run) ? 'this part was rewritten.' : 'ce passage a été réécrit.'}`)
  return `# ${run.videoTitle}\n\n${body.join('\n\n')}`
}

function briefText(run: RunDetail): string {
  return [
    `Sujet : ${run.topic}`,
    '',
    'Angle retenu : raconter les faits établis d’abord, les hypothèses ensuite, sans affirmer ce que les sources ne disent pas.',
    'Sources lues : 7 (archives publiques, deux ouvrages de référence, articles de presse d’époque).',
    'Points à vérifier : deux dates contradictoires, un témoignage rapporté de seconde main.',
    `Durée visée : ${run.minutes} min · ton : posé, mystérieux, jamais sensationnaliste.`
  ].join('\n')
}

const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length
const dur = (run: RunDetail): number => run.durationS ?? Math.round(run.minutes * 60 + 7)

function ref(nodeId: string, name: string, run: RunDetail, mime: string): RunFileRef {
  return { ref: `${nodeId}/${name}`, name, size: claimedSize(name, dur(run)), mime }
}

function words(run: RunDetail): RunWord[] {
  const all = paragraphs(run).join(' ').split(/\s+/).filter(Boolean)
  const step = dur(run) / Math.max(1, all.length)
  return all.map((word, i) => ({ word, start: +(i * step).toFixed(2), end: +((i + 0.8) * step).toFixed(2) }))
}

function shots(run: RunDetail): RunPlanShot[] {
  const d = dur(run)
  const beat = d / BEATS
  const titles = en(run) ? SECTIONS_EN : SECTIONS_FR
  const out: RunPlanShot[] = []
  for (let b = 0; b < BEATS; b++) {
    const start = +(b * beat).toFixed(2)
    const end = +((b + 1) * beat).toFixed(2)
    const mid = +((start + end) / 2).toFixed(2)
    out.push({ id: `s${b}a`, track: 'base', start, end: mid, kind: b % 2 ? 'stock.photo' : 'image.gen', label: `${titles[b] ?? ''} — plan large`, beat: b, itemId: `img-${b}`, credits: b % 2 ? 0 : 4 })
    out.push({ id: `s${b}b`, track: 'base', start: mid, end, kind: 'image.gen', label: `${titles[b] ?? ''} — détail`, beat: b, itemId: `img-${b}`, credits: 0 })
    out.push({ id: `s${b}l`, track: 'labels', start, end: +(start + Math.min(4, beat / 2)).toFixed(2), kind: 'label', label: titles[b] ?? '', beat: b, itemId: null, credits: 0 })
  }
  return out
}

function chapters(run: RunDetail): { title: string; start: number }[] {
  const titles = en(run) ? SECTIONS_EN : SECTIONS_FR
  return titles.map((title, i) => ({ title, start: Math.round((i * dur(run)) / BEATS) }))
}

function srt(run: RunDetail): { text: string; cues: number } {
  const ws = words(run)
  const cues: string[] = []
  const clock = (s: number): string => {
    const ms = Math.round(s * 1000)
    const p = (n: number, l = 2): string => String(n).padStart(l, '0')
    return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
  }
  for (let i = 0; i < ws.length; i += 6) {
    const g = ws.slice(i, i + 6)
    cues.push(`${cues.length + 1}\n${clock(g[0]!.start)} --> ${clock(g[g.length - 1]!.end)}\n${g.map((w) => w.word).join(' ')}`)
  }
  return { text: cues.join('\n\n'), cues: cues.length }
}

export function packageFiles(run: RunDetail): RunFileRef[] {
  return [
    ref('package', 'video.mp4', run, 'video/mp4'),
    ref('package', 'thumbnail.png', run, 'image/png'),
    ref('package', 'captions.srt', run, 'application/x-subrip'),
    ref('package', 'description.txt', run, 'text/plain'),
    ref('package', 'metadata.json', run, 'application/json')
  ]
}

export function packageTexts(run: RunDetail): { title: string; alternatives: string[]; description: string; tags: string[]; chapters: { at: number; title: string }[] } {
  const e = en(run)
  return {
    title: run.videoTitle,
    alternatives: e ? [`${run.videoTitle}: The Real Story`, `Nobody Explains This Part of ${run.videoTitle}`] : [`${run.videoTitle} : la vraie histoire`, `Personne ne raconte cette partie de « ${run.videoTitle} »`],
    description: e
      ? `${run.topic}\n\nSources are listed in the pinned comment. Made with invented demo data.`
      : `${run.topic}\n\nLes sources sont listées dans le commentaire épinglé. Vidéo de démonstration, données fictives.`,
    tags: e ? ['mystery', 'history', 'documentary', 'unsolved'] : ['histoire', 'mystère', 'documentaire', 'énigme'],
    chapters: chapters(run).map((c) => ({ at: c.start, title: c.title }))
  }
}

const NOT_READY: RunOutput = { kind: 'unavailable', reason: 'not_ready', message: 'Cette étape n’est pas encore faite : son résultat s’affichera ici.' }

export function outputOf(run: RunDetail, nodeId: string): RunOutput {
  const node = run.nodes.find((n) => n.nodeId === nodeId)
  if (!node) return { kind: 'unavailable', reason: 'missing', message: 'Cette étape n’existe pas dans la fabrication.' }
  if (!['done', 'cached', 'waiting_gate'].includes(node.state)) return NOT_READY
  const d = dur(run)
  switch (nodeId) {
    case 'research': {
      const text = briefText(run)
      return { kind: 'text', nodeId, text, previous: null, words: countWords(text), outline: null, demo: run.demo }
    }
    case 'script': {
      const n = revisions.get(`${run.id}:script`)?.length ?? 0
      const text = scriptText(run)
      return {
        kind: 'text',
        nodeId,
        text,
        previous: n > 0 ? scriptText(run, n - 1) : null,
        words: countWords(text),
        outline: { title: run.videoTitle, sections: en(run) ? SECTIONS_EN : SECTIONS_FR },
        demo: run.demo
      }
    }
    case 'voice':
      return { kind: 'audio', nodeId, file: ref(nodeId, 'narration.wav', run, 'audio/wav'), durationS: d, voice: run.style.voice ?? 'demo-claire', voiceUsed: run.demo ? 'Voix système (démo)' : 'Claire — voix studio', words: words(run), demo: run.demo }
    case 'plan': {
      const s = shots(run)
      const items = Array.from({ length: BEATS }, (_, b) => ({
        id: `img-${b}`,
        kind: b % 2 ? 'stock.photo' : 'image.gen',
        prompt: `${run.videoTitle}, scène ${b + 1} : lumière rasante, palette froide, grain léger`,
        units: 1,
        credits: b % 2 ? 0 : 4,
        shotIds: s.filter((x) => x.itemId === `img-${b}`).map((x) => x.id)
      }))
      const credits = items.reduce((t, i) => t + i.credits, 0)
      return {
        kind: 'editplan',
        nodeId,
        durationS: d,
        fps: 30,
        shots: s,
        chapters: chapters(run),
        items,
        totals: { credits, items: items.length, shots: s.length, byKind: { 'image.gen': 3, 'stock.photo': 3 } },
        captionsPreset: run.style.captions ?? 'highlight'
      }
    }
    case 'visuals':
      return {
        kind: 'images',
        nodeId,
        images: Array.from({ length: BEATS }, (_, b) => ({ file: ref(nodeId, `beat-${b + 1}.png`, run, 'image/png'), itemId: `img-${b}`, beat: b, prompt: `${run.videoTitle}, scène ${b + 1}`, source: b % 2 ? 'stock' : 'génération', demo: run.demo })),
        demo: run.demo
      }
    case 'music':
      return { kind: 'music', nodeId, file: ref(nodeId, 'ambiance.wav', run, 'audio/wav'), durationS: d, demo: run.demo }
    case 'captions': {
      const s = srt(run)
      return { kind: 'captions', nodeId, files: [ref(nodeId, 'captions.srt', run, 'application/x-subrip')], srt: s.text, preset: run.style.captions ?? 'highlight', burn: run.style.burn ?? true, cues: s.cues }
    }
    case 'render':
      return { kind: 'video', nodeId, file: ref(nodeId, 'video.mp4', run, 'video/mp4'), durationS: d, width: portrait(run) ? 1080 : 1920, height: portrait(run) ? 1920 : 1080, demo: run.demo }
    case 'thumbnail':
      return { kind: 'images', nodeId, images: [{ file: ref(nodeId, 'thumbnail.png', run, 'image/png'), itemId: 'thumb', beat: null, prompt: 'Miniature retenue : titre court, fort contraste', source: 'génération', demo: run.demo }], demo: run.demo }
    case 'package':
      return { kind: 'package', nodeId, ...packageTexts(run), files: packageFiles(run), folder: `Atelier/Production/run-${run.id}/paquet`, demo: run.demo }
    default:
      return NOT_READY
  }
}

/** Bytes of a file of the run: pictures (SVG), sounds (WAV) and texts are made now; the video has none in the demo. */
export function fileOf(run: RunDetail, fileRef: string): RunFile {
  const name = fileRef.split('/').pop() ?? fileRef
  const make = (bytes: Uint8Array, mime: string): RunFile => ({ name, mime, size: bytes.length, bytes })
  if (/\.mp4$/.test(name)) throw new Error('Démo : la vidéo finie n’est pas lue dans le navigateur (aucun fichier réel). Dans l’app, elle se lit ici.')
  if (/\.(png|jpg)$/.test(name)) {
    const beat = /beat-(\d+)/.exec(name)?.[1]
    const caption = beat ? `${run.channelName} · scène ${beat}` : `${run.channelName} · miniature`
    return make(svgBytes(posterSvg(run.videoTitle, caption, { seed: `${run.videoTitle}${beat ?? ''}`, portrait: portrait(run) })), 'image/svg+xml')
  }
  if (/\.wav$/.test(name)) return make(toneWav(dur(run), name.startsWith('narration') ? 'voice' : 'music'), 'audio/wav')
  if (/\.srt$/.test(name)) return make(textBytes(srt(run).text), 'application/x-subrip')
  if (name === 'description.txt') return make(textBytes(packageTexts(run).description), 'text/plain')
  if (name === 'metadata.json') return make(textBytes(JSON.stringify(packageTexts(run), null, 2)), 'application/json')
  throw new Error('Ce fichier n’existe pas dans la démo.')
}

export function libraryItem(run: RunDetail): LibraryItem {
  return {
    runId: run.id,
    videoId: run.videoId,
    title: run.videoTitle,
    channelId: run.channelId,
    channelName: run.channelName,
    durationS: run.durationS,
    minutes: run.minutes,
    pipelineId: run.pipelineId,
    pipelineLabel: run.pipelineLabel,
    pipelineVersion: run.pipelineVersion,
    budgetMode: run.budgetMode,
    totalCredits: run.spentCredits,
    creditsByNode: run.nodes.map((n) => ({ nodeId: n.nodeId, label: n.label, credits: n.credits })),
    videoFileRef: run.videoFileRef,
    packageDir: run.packageDir,
    packageFiles: packageFiles(run),
    finishedAt: run.finishedAt,
    demo: run.demo,
    example: false
  }
}
