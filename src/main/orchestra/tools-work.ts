// The specialists' technologies: the eyes (eyes.look and the channel reads), research, script, packaging, production
// runs and quality checks. Every handler goes through a service of the app (services.ts) and checks that the agent stays
// on its own channel. Team files (scripts, briefs, reports) live under the team folder, one sub-folder per channel.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { cleanScript, detectLanguage, lintScript, wpmFor } from '../../engine/text/lint'
import type { RunDetail, RunOutput } from '../../shared/runs'
import { eyesLook, inside } from './eyes-look'
import { styleLine } from './layers'
import { int, need, num, opt, type Handler, type ToolCtx } from './tool-args'
import { iso, truncate } from './util'

export type { ToolOut } from './tool-args'

const slugify = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'file'

/** The channel a tool works on: the one asked, which must be the agent's own when it has one. */
function channelOf(c: ToolCtx, raw: unknown): number {
  const id = raw === undefined || raw === null ? c.channelId : int(raw, 'channel')
  if (id === null) throw new Error('No channel: give its id')
  if (c.agent.channelId !== null && id !== c.agent.channelId) throw new Error(`You work for channel #${c.agent.channelId} only`)
  return id
}

const channelDir = (c: ToolCtx): string => (c.channelId === null ? 'workspace' : `channel-${c.channelId}`)

function saveTeamFile(c: ToolCtx, sub: string, name: string, text: string): string {
  const rel = path.posix.join(channelDir(c), sub, name)
  const abs = inside(c.env.teamDir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, text, 'utf8')
  return rel
}

export function readTeamFile(c: ToolCtx, rel: string): string {
  const abs = inside(c.env.teamDir, rel)
  if (!existsSync(abs)) throw new Error(`No team file ${rel}`)
  return readFileSync(abs, 'utf8')
}

function production(c: ToolCtx): NonNullable<ToolCtx['env']['services']['production']> {
  const p = c.env.services.production
  if (!p) throw new Error('Production runs are not available here')
  return p
}

/**
 * The sound of a finished run, from the QC node's own report (decision 0086: the film's measures and the render's edit
 * review, no second check): silence, loudness, and the review's voice holes / clicks / music level. Free: nothing is
 * played or paid. When the report is not there the line says the sound was NOT verified, so a verdict never claims it.
 */
async function soundChecks(c: ToolCtx, run: RunDetail): Promise<string[]> {
  const node = run.nodes.find((n) => n.type.startsWith('qc.check') && (n.state === 'done' || n.state === 'cached'))
  const unverified = ['WARN sound: not verified (the run has no finished QC report): listen with eyes.watchVideo before saying the music and the voice are fine.']
  if (!node) return unverified
  let out: RunOutput
  try {
    out = await production(c).output(run.id, node.nodeId)
  } catch {
    return unverified
  }
  if (out.kind !== 'json') return unverified
  const report = out.outputs.report?.value as { checks?: { id: string; status: string; detail: string; data?: { kinds?: string[] } }[] } | undefined
  const checks = report?.checks ?? []
  const pick = (id: string) => checks.find((k) => k.id === id)
  const silence = pick('silence')
  const loudness = pick('loudness')
  if (!silence && !loudness) return unverified
  const mark = (status: string): string => (status === 'ok' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL')
  const line = (name: string, k: { status: string; detail: string } | undefined): string | null => (k ? `${mark(k.status)} ${name}: ${k.detail}` : null)
  const edit = pick('edit')
  const audioKinds = (edit?.data?.kinds ?? []).filter((k) => k === 'audio_dropout' || k === 'audio_click' || k === 'music_loud')
  const review = edit ? `${audioKinds.length ? 'WARN' : 'PASS'} sound review (voice holes, clicks, music level): ${audioKinds.length ? `left after the render's own fixes: ${audioKinds.join(', ')}` : 'nothing left'}` : null
  return [line('silence', silence), line('loudness', loudness), review].filter((x): x is string => x !== null)
}

/** A run of the agent's channel (an agent of one channel never touches another channel's runs). */
function ownRun(c: ToolCtx, raw: unknown): RunDetail {
  const run = production(c).get(int(raw, 'run'))
  if (c.agent.channelId !== null && run.channelId !== c.agent.channelId) throw new Error(`Run #${run.id} is not one of your channel's runs`)
  return run
}

const runLine = (r: RunDetail): string =>
  `#${r.id} « ${truncate(r.videoTitle || r.topic, 80)} » ${r.status}${r.waitingNodes.length ? ` · waits at ${r.waitingNodes.join(', ')}` : ''} · ${Math.round(r.progress * 100)} % · ${r.spentCredits}/${r.quoteCredits} credits${r.demo ? ' · demo' : ''}${r.error ? ` · error: ${truncate(r.error, 160)}` : ''}`

async function sourceScript(c: ToolCtx, a: Record<string, unknown>): Promise<string | null> {
  if (a.teamFile !== undefined) return readTeamFile(c, need(a.teamFile, 'teamFile', 300))
  if (a.run === undefined) return null
  const run = ownRunOrSource(c, a.run)
  const m = await production(c).media(run.id)
  return m.words.length ? m.words.map((w) => w.word).join(' ') : null
}

/** A translation may read the source channel's run (the one it translates): allowed when this channel says so. */
function ownRunOrSource(c: ToolCtx, raw: unknown): RunDetail {
  const run = production(c).get(int(raw, 'run'))
  if (c.agent.channelId === null || run.channelId === c.agent.channelId) return run
  const memory = c.env.context.channel(c.agent.channelId).text
  if (new RegExp(`Traduit la chaîne : .*\\(#${run.channelId}\\)`).test(memory)) return run
  throw new Error(`Run #${run.id} is not one of your channel's runs`)
}

/** Credits this month of the channel's runs (what they spent), for the real-run budget check. */
export function spentThisMonth(c: ToolCtx, channelId: number): number {
  const month = new Date(c.env.now()).toISOString().slice(0, 7)
  const runs = c.env.services.production?.list({ channelId, limit: 200 }) ?? []
  return runs.filter((r) => (r.startedAt ?? r.createdAt).slice(0, 7) === month).reduce((n, r) => n + r.spentCredits, 0)
}

/**
 * What the team may spend: the channel's monthly budget (its goals) minus this month's runs. Never the local ledger's
 * balance, which reads 0 on a brain whose wallet is Atelier Cloud's (production-equipe: the team thought it had nothing).
 */
function budgetLine(c: ToolCtx): string {
  if (c.channelId === null) return ''
  const goals = c.env.goals.get(c.channelId)
  if (!goals) return ' No monthly budget set for the channel yet.'
  const left = Math.max(0, goals.budgetCredits - spentThisMonth(c, c.channelId))
  return ` Channel budget left this month: ${left} credits of ${goals.budgetCredits}.`
}

export const WORK_TOOLS: Record<string, Handler> = {
  'eyes.look': async (c, a) => {
    const svc = c.env.services
    const stamp = `look-${c.task.id}-${c.env.now()}`
    const out = await eyesLook(
      {
        ...(a.file !== undefined ? { file: need(a.file, 'file', 1000) } : {}),
        ...(a.run !== undefined ? { run: ownRunOrSource(c, a.run).id } : {}),
        ...(a.teamFile !== undefined ? { teamFile: path.posix.join(need(a.teamFile, 'teamFile', 300)) } : {}),
        ...(a.url !== undefined ? { url: need(a.url, 'url', 500) } : {}),
        ...(a.pass === 'detailed' ? { pass: 'detailed' as const } : {}),
        ...(a.frames !== undefined ? { frames: Math.round(num(a.frames, 'frames', 1, 16)) } : {})
      },
      {
        media: svc.media?.() ?? null,
        outDir: c.env.eyesDir,
        teamDir: c.env.teamDir,
        ...(svc.production ? { runMedia: (id: number) => (svc.production as NonNullable<typeof svc.production>).media(id) } : {}),
        ...(svc.youtube ? { youtube: { ready: svc.youtube.ready, analyse: svc.youtube.analyse, ...(svc.youtube.whole ? { whole: svc.youtube.whole } : {}), facts: (id: string) => svc.eyes?.youtubeFacts(id) ?? null } } : {}),
        signal: c.signal,
        stamp
      }
    )
    return out.images.length ? { text: out.text, images: out.images } : out.text
  },
  'channel.read': async (c, a) => {
    const eyes = c.env.services.eyes
    if (!eyes) throw new Error('The channel reads are not available here')
    const r = await eyes.read(channelOf(c, a.channel), c.signal)
    return `Read ${r.channelsRead} channel(s): ${r.videos} videos, ${r.outliers} outlier(s)${r.demo ? ' (Atelier Cloud demo data)' : ''}.${r.problems.length ? ` Problems: ${r.problems.join(' ; ')}` : ''} Use channel.outliers next.`
  },
  'channel.outliers': (c, a) => {
    const eyes = c.env.services.eyes
    if (!eyes) throw new Error('The channel reads are not available here')
    const limit = a.limit === undefined ? 10 : Math.round(num(a.limit, 'limit', 1, 30))
    const rows = eyes.outliers(channelOf(c, a.channel)).slice(0, limit)
    if (!rows.length) return 'No outlier yet: the channel and its competitors were not read (channel.read), or nothing stands out.'
    return rows.map((r) => `- ${r.title} (${r.channelName}) · ${r.views} views · ×${r.score}${r.demo ? ' · demo' : ''} · ${r.url}\n  why: ${r.why}`).join('\n')
  },
  'ideas.list': (c, a) => {
    const eyes = c.env.services.eyes
    if (!eyes) throw new Error('The channel reads are not available here')
    const items = eyes.inspirationFor(channelOf(c, a.channel), a.limit === undefined ? 5 : Math.round(num(a.limit, 'limit', 1, 20)))
    return items.length ? items.map((i) => `- ${i.title} (${i.channel}): ${i.why}`).join('\n') : 'No inspiration yet: no watched competitor was read.'
  },
  'style.profile': (c, a) => {
    const id = channelOf(c, a.channel)
    const p = c.env.services.eyes?.profileFor(id) ?? null
    if (!p) return `Channel #${id} has no style profile yet (the eyes build one from analysed videos). Its memory:\n${c.env.context.channel(id).text || '(empty)'}`
    return `${styleLine(p, c.env.services.eyes?.profileVersion(id) ?? null)}\n${JSON.stringify(p)}`
  },
  'thumbnail.brief': (c, a) => {
    const id = channelOf(c, a.channel)
    const p = c.env.services.eyes?.profileFor(id) ?? null
    const row = c.env.services.channels?.list().find((x) => x.id === id)
    return [
      p ? `Thumbnail traits: ${p.thumbnail.traits.join(', ') || 'none noted'} · face: ${p.thumbnail.face ? 'yes' : 'no'} · layout: ${p.thumbnail.layout}` : 'No style profile yet.',
      row?.thumbnailStyle ? `The owner's notes: ${row.thumbnailStyle}` : "No note from the owner about thumbnails."
    ].join('\n')
  },
  'script.brief': async (c, a) => {
    const id = c.channelId
    const lang = opt(a.language, 'language', 12)
    const source = await sourceScript(c, a)
    const p = id !== null ? (c.env.services.eyes?.profileFor(id) ?? null) : null
    return [
      `Channel memory:\n${id !== null ? c.env.context.channel(id).text || '(empty)' : '(no channel)'}`,
      p ? `Style profile: ${styleLine(p, null)}` : 'No style profile yet: follow the channel memory.',
      lang ? `Write in: ${lang} (about ${wpmFor(lang)} words per minute of video).` : '',
      source !== null ? `Source script to translate (keep every paragraph and sentence, same order):\n${truncate(source, 12_000)}` : 'No source script: write an original one.',
      'When it is finished, save it with script.save.'
    ]
      .filter(Boolean)
      .join('\n\n')
  },
  'script.save': (c, a) => {
    const title = need(a.title, 'title', 120)
    const text = cleanScript(need(a.text, 'text', 60_000))
    if (!text) throw new Error('The script is empty once cleaned (only notes or headings?)')
    const lang = opt(a.language, 'language', 12)
    const lint = lintScript(text)
    const detected = detectLanguage(text)
    const rel = saveTeamFile(c, 'scripts', `${slugify(title)}.md`, text)
    const minutes = lint.words / wpmFor(lang ?? (detected === 'other' ? 'en' : detected))
    const problems = [...lint.failures, ...(lang && detected !== 'other' && !lang.toLowerCase().startsWith(detected) ? [`language: reads as ${detected}, not ${lang}`] : [])]
    c.remember(`script:${slugify(title)}`, { teamFile: rel, at: iso(c.env.now()) })
    return `Saved as team file ${rel}: ${lint.words} words (about ${minutes.toFixed(1)} min), ${lint.sentences} sentences. ${problems.length ? `Checks to fix: ${problems.join(', ')}.` : 'Checks passed.'}`
  },
  'files.save': (c, a) => {
    const name = need(a.name, 'name', 80)
    const ext = /\.(md|txt)$/i.test(name) ? '' : '.md'
    const rel = saveTeamFile(c, 'notes', `${slugify(name.replace(/\.(md|txt)$/i, ''))}${ext || path.extname(name).toLowerCase()}`, need(a.text, 'text', 40_000))
    return `Saved as team file ${rel}.`
  },
  'production.quote': async (c, a) => {
    const q = await production(c).quote({
      topic: need(a.topic, 'topic', 2000),
      minutes: a.minutes === undefined ? 8 : num(a.minutes, 'minutes', 0.5, 30),
      ...(a.pipeline !== undefined ? { pipelineId: int(a.pipeline, 'pipeline') } : {}),
      ...(c.channelId !== null ? { channelId: c.channelId } : {})
    })
    const m = q.modes.usage_max
    return `${q.pipelineLabel} v${q.pipelineVersion}, ${q.minutes} min: ${m.totalCredits} credits (${m.totalEur.toFixed(2)} €) in usage_max, ${q.modes.qualite_max.totalCredits} in qualite_max${q.demo ? `. Demo: ${q.demoReason}` : ''}.${budgetLine(c)}`
  },
  'production.start': async (c, a) => {
    const done = c.effect('run')
    if (typeof done === 'number') return `Already started in this task: ${runLine(production(c).get(done))}`
    if (c.channelId === null) throw new Error('A run is for a channel: you have none')
    // « Moteur réel » (production-16): real credits only with Charlie's approval in this task; the Cloud keeps the caps
    const real = a.real === true
    if (a.real !== undefined && typeof a.real !== 'boolean') throw new Error('real: true or false')
    if (real && !c.approved()) throw new Error('A real run spends real credits: ask Charlie first (ask_human, kind validate), then start it in your next turn')
    const svc = production(c)
    const pipelineId = a.pipeline !== undefined ? int(a.pipeline, 'pipeline') : undefined
    const scriptFile = opt(a.scriptFile, 'scriptFile', 300)
    const takes = svc.pipelineInputs(pipelineId)
    const inputs: Record<string, string> = {}
    if (scriptFile && takes.includes('script')) inputs.script = readTeamFile(c, scriptFile)
    const run = await svc.start({
      channelId: c.channelId,
      title: need(a.title, 'title', 200),
      topic: need(a.topic, 'topic', 2000),
      minutes: a.minutes === undefined ? 8 : num(a.minutes, 'minutes', 0.5, 30),
      budgetMode: 'usage_max',
      gateMode: 'step',
      ...(pipelineId !== undefined ? { pipelineId } : {}),
      ...(Object.keys(inputs).length ? { inputs } : {}),
      ...(real ? { real: true } : {})
    })
    c.remember('run', run.id)
    const note = scriptFile && !takes.includes('script') ? ` This pipeline writes its own script (it takes no script input): ${scriptFile} is kept as the reference.` : ''
    return `Started ${real ? 'a REAL' : 'a demo'} run ${runLine(run)}. It stops at each gate for Charlie (step by step).${note}`
  },
  'production.status': (c, a) => {
    if (a.run !== undefined) {
      const r = ownRun(c, a.run)
      return [runLine(r), ...r.nodes.map((n) => `  ${n.nodeId} (${n.type}): ${n.state}${n.error ? ` · ${truncate(n.error.message, 120)}` : ''}`)].join('\n')
    }
    const rows = production(c).list({ ...(c.agent.channelId !== null ? { channelId: c.agent.channelId } : {}), limit: 10 })
    return rows.length ? rows.map((r) => runLine(r as RunDetail)).join('\n') : 'No run yet.'
  },
  'production.approve': (c, a) => {
    if (!c.approved()) throw new Error('Charlie has not approved this step in this task: ask him (ask_human) first')
    const run = ownRun(c, a.run)
    const node = need(a.node, 'node', 80)
    if (!run.waitingNodes.includes(node)) throw new Error(`Run #${run.id} does not wait at ${node} (it waits at: ${run.waitingNodes.join(', ') || 'nothing'})`)
    return `Approved: ${runLine(production(c).approve(run.id, node))}`
  },
  'production.cancel': async (c, a) => {
    const run = ownRun(c, a.run)
    need(a.why, 'why', 300)
    return `Cancelled: ${runLine(await production(c).cancel(run.id))}`
  },
  'qc.check': async (c, a) => {
    if (a.text !== undefined) {
      const text = cleanScript(need(a.text, 'text', 60_000))
      const lint = lintScript(text)
      const lang = opt(a.language, 'language', 12)
      const detected = detectLanguage(text)
      const checks = [
        ['length', lint.words >= 80, `${lint.words} words`],
        ['sentences', !lint.failures.includes('sentence_length') && !lint.failures.includes('long_sentences'), `${lint.avgSentenceWords} words per sentence`],
        ['spoken forms', !lint.failures.includes('numbers'), `${lint.numbersPer100} numbers per 100 words`],
        ['openings', !lint.failures.includes('repeated_openings'), lint.repeatedOpenings.join(', ') || 'varied'],
        ['language', !lang || detected === 'other' || lang.toLowerCase().startsWith(detected), `reads as ${detected}`]
      ] as const
      return checks.map(([n, ok, note]) => `${ok ? 'PASS' : 'FAIL'} ${n}: ${note}`).join('\n')
    }
    const run = ownRun(c, a.run)
    const failed = run.nodes.filter((n) => n.state === 'error')
    const open = run.nodes.filter((n) => n.state !== 'done' && n.state !== 'cached')
    const checks = [
      ['nodes', failed.length === 0, failed.length ? `failed: ${failed.map((n) => n.nodeId).join(', ')}` : 'none failed'],
      ['finished', open.length === 0, open.length ? `not done: ${open.map((n) => `${n.nodeId} (${n.state})`).join(', ')}` : 'every node done'],
      ['video', run.videoFileRef !== null, run.videoFileRef ? 'rendered' : 'not rendered yet'],
      ['demo', !run.demo, run.demo ? 'made with demo providers: never publish' : 'real providers']
    ] as const
    const sound = await soundChecks(c, run)
    return [runLine(run), ...checks.map(([n, ok, note]) => `${ok ? 'PASS' : 'FAIL'} ${n}: ${note}`), ...sound, 'Look at the frames with eyes.look (run) before your verdict.'].join('\n')
  }
}
