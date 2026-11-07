// `production.output`: what one node produced, typed for its review screen. Reads the artefacts through the engine's
// store API (`getRun(fingerprint)`); file paths become refs for `production.file`.
import { readFile } from 'node:fs/promises'
import type { Artefact } from '../../../engine/artefacts'
import type { ArtefactStore, StoredRun } from '../../../engine/store'
import { t } from '../../../shared/fr'
import type { RunFileRef, RunOutput, RunPlanShot, RunWord } from '../../../shared/runs'
import { fileRef } from './files'
import type { NodeRow, RunRow } from './rows'

type J = Record<string, unknown>
const obj = (v: unknown): J => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as J) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown): boolean => v === true
const FPS = 30

export interface OutputCtx {
  run: RunRow
  node: NodeRow
  /** Every node of the run (cross references: the images' beats come from the director's plan). */
  nodes: NodeRow[]
  store: ArtefactStore
  /** The video's artefact folder (refs are relative to it). */
  root: string
}

const unavailable = (reason: 'example' | 'not_ready' | 'missing'): RunOutput => ({
  kind: 'unavailable',
  reason,
  message: t(reason === 'example' ? 'runs.example.noFiles' : reason === 'not_ready' ? 'runs.output.notReady' : 'runs.output.missing')
})

async function refs(root: string, a: Artefact | undefined): Promise<RunFileRef[]> {
  return Promise.all((a?.files ?? []).map((f) => fileRef(root, f)))
}

const family = (type: string): string => type.split('@')[0] ?? type

export async function nodeOutput(c: OutputCtx): Promise<RunOutput> {
  const { run, node, store, root } = c
  if (!node.fingerprint) return unavailable(run.example === 1 ? 'example' : 'not_ready')
  const stored = await store.getRun(node.fingerprint).catch(() => null)
  if (!stored) return unavailable(run.example === 1 ? 'example' : 'missing')
  const o = stored.outputs
  const id = node.node_id
  switch (family(node.type)) {
    case 'research.topic':
    case 'script.write': {
      const main = o.text ?? o.brief
      const text = str(main?.value)
      let previous: string | null = null
      if (node.previous_fingerprint) {
        const prev = await store.getRun(node.previous_fingerprint).catch(() => null)
        const pv = prev?.outputs.text ?? prev?.outputs.brief
        if (pv && typeof pv.value === 'string') previous = pv.value
      }
      const ol = o.outline ? obj(o.outline.value) : null
      const outline = ol
        ? {
            title: str(ol.title),
            sections: arr(ol.chapters).map((ch) => str(obj(ch).title)).filter(Boolean)
          }
        : null
      return {
        kind: 'text',
        nodeId: id,
        text,
        previous,
        words: text.split(/\s+/).filter(Boolean).length,
        outline,
        demo: bool(main?.meta?.demo) || run.demo === 1
      }
    }
    case 'voice.tts':
    case 'voice.own': {
      const audio = o.audio
      const [file] = await refs(root, audio)
      if (!file) return unavailable('missing')
      const words: RunWord[] = arr(o.words?.value).map((w) => {
        const x = obj(w)
        return { word: str(x.w), start: num(x.start) ?? 0, end: num(x.end) ?? 0 }
      })
      const meta = audio?.meta ?? {}
      return {
        kind: 'audio',
        nodeId: id,
        file,
        durationS: num(meta.durationS),
        voice: str(meta.voice) || null,
        voiceUsed: str(meta.systemVoice) || str(meta.source) || null,
        words,
        demo: bool(meta.demo)
      }
    }
    case 'director.plan':
    case 'director.pov':
      return editPlan(id, stored)
    case 'visuals.fulfil':
      return images(c, stored)
    case 'captions.make': {
      const files = await refs(root, o.subs)
      const srtFile = (o.subs?.files ?? []).find((f) => f.toLowerCase().endsWith('.srt'))
      const srt = srtFile ? await readFile(srtFile, 'utf8').catch(() => '') : ''
      const meta = o.subs?.meta ?? {}
      return { kind: 'captions', nodeId: id, files, srt, preset: str(meta.preset) || null, burn: bool(meta.burn), cues: num(meta.cues) ?? 0 }
    }
    case 'sound.music': {
      const [file] = await refs(root, o.music)
      if (!file) return unavailable('missing')
      return { kind: 'music', nodeId: id, file, durationS: num(o.music?.meta?.durationS), demo: bool(o.music?.meta?.demo) }
    }
    case 'render.assemble': {
      const [file] = await refs(root, o.video)
      if (!file) return unavailable('missing')
      const m = o.video?.meta ?? {}
      return { kind: 'video', nodeId: id, file, durationS: num(m.durationS), width: num(m.width), height: num(m.height), demo: bool(m.demo) }
    }
    case 'package.youtube': {
      const md = obj(o.metadata?.value)
      return {
        kind: 'package',
        nodeId: id,
        title: str(md.title),
        alternatives: arr(md.alternatives).map(str).filter(Boolean),
        description: str(md.description),
        chapters: arr(md.chapters).map((ch) => ({ at: num(obj(ch).at) ?? 0, title: str(obj(ch).title) })),
        tags: arr(md.tags).map(str).filter(Boolean),
        files: await refs(root, o.package),
        folder: run.package_dir,
        demo: bool(md.demo) || run.demo === 1
      }
    }
    default: {
      const outputs: Record<string, { type: string; value: unknown; files: RunFileRef[] }> = {}
      for (const [name, a] of Object.entries(o)) {
        const text = a.value === undefined ? '' : JSON.stringify(a.value)
        outputs[name] = { type: a.type, value: text.length > 200_000 ? `${text.slice(0, 200_000)}…` : (a.value ?? null), files: await refs(root, a) }
      }
      return { kind: 'json', nodeId: id, outputs }
    }
  }
}

function editPlan(id: string, stored: StoredRun): RunOutput {
  const plan = obj(stored.outputs.plan?.value)
  const gen = obj(stored.outputs.genlist?.value)
  const items = arr(gen.items).map((it) => {
    const x = obj(it)
    const units = num(x.units) ?? 0
    return {
      id: str(x.id),
      kind: str(x.kind),
      prompt: str(x.prompt) || str(x.query),
      units,
      credits: Math.ceil((num(x.unitPrice) ?? 0) * units),
      shotIds: arr(x.shotIds).map(str)
    }
  })
  const byItem = new Map(items.map((i) => [i.id, i]))
  const shots: RunPlanShot[] = arr(plan.shots).map((s) => {
    const x = obj(s)
    const itemId = str(x.genItem) || null
    const item = itemId ? byItem.get(itemId) : undefined
    return {
      id: str(x.id),
      track: (['base', 'overlay', 'labels'].includes(str(x.track)) ? str(x.track) : 'base') as RunPlanShot['track'],
      start: (num(x.startFrame) ?? 0) / FPS,
      end: (num(x.endFrame) ?? 0) / FPS,
      kind: str(x.kind),
      label: str(x.text) || item?.prompt || '',
      beat: num(x.beat) ?? 0,
      itemId,
      credits: item?.credits ?? 0
    }
  })
  const totals = obj(gen.totals)
  const byKind: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj(totals.byKind))) if (typeof v === 'number') byKind[k] = v
  return {
    kind: 'editplan',
    nodeId: id,
    durationS: (num(plan.frames) ?? 0) / FPS,
    fps: num(plan.fps) ?? FPS,
    shots,
    chapters: arr(plan.chapters).map((ch) => ({ title: str(obj(ch).title), start: (num(obj(ch).startFrame) ?? 0) / FPS })),
    items,
    totals: { credits: items.reduce((s, i) => s + i.credits, 0), items: items.length, shots: shots.length, byKind },
    captionsPreset: str(plan.captionsPreset)
  }
}

async function images(c: OutputCtx, stored: StoredRun): Promise<RunOutput> {
  const a = stored.outputs.images
  const files = a?.files ?? []
  // beats of each item, from the director's plan of the same run (when it is still in the store)
  const beatOf = new Map<string, number>()
  const director = c.nodes.find((n) => family(n.type) === 'director.plan' && n.fingerprint)
  if (director?.fingerprint) {
    const d = await c.store.getRun(director.fingerprint).catch(() => null)
    for (const s of arr(obj(d?.outputs.plan?.value).shots)) {
      const x = obj(s)
      if (str(x.genItem) && !beatOf.has(str(x.genItem))) beatOf.set(str(x.genItem), num(x.beat) ?? 0)
    }
  }
  const list = []
  for (const [i, r] of arr(a?.value).entries()) {
    const x = obj(r)
    const idx = num(x.file) ?? i
    const abs = files[idx]
    if (!abs) continue
    list.push({
      file: await fileRef(c.root, abs),
      itemId: str(x.itemId),
      beat: beatOf.get(str(x.itemId)) ?? null,
      prompt: str(x.prompt),
      source: str(x.source),
      demo: bool(x.demo)
    })
  }
  return { kind: 'images', nodeId: c.node.node_id, images: list, demo: bool(a?.meta?.demo) }
}
