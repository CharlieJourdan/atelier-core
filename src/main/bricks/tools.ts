// The motion designer's technologies (docs/AGENT-RUNTIME.md §23): `bricks.draft`, `bricks.preview`, `bricks.propose`. The Monteur
// (video_producer) of a channel writes a custom brick, renders a preview in the sandboxed headless browser (motion/brick-render.ts), LOOKS
// at the stills (they come back as images, like eyes.look's frames, so its own Claude sees them on the subscription), fixes it and tries
// again, at most MAX_TRIES previews a round and PREVIEW_BUDGET_MS each; then it proposes the brick to Charlie through his inbox, and its
// task waits for the answer. Nothing of the brick ever runs in the app's processes: it is data written to files, drawn only by the browser.
import { existsSync } from 'node:fs'
import { previewBrick } from '../../engine/motion/brick-render'
import { customTemplate, type BrickInput } from '../../engine/formats/brick'
import type { Handler, ToolCtx } from '../orchestra/tool-args'
import { need, opt } from '../orchestra/tool-args'
import { isRecord, truncate } from '../orchestra/util'
import { MAX_TRIES, type BrickRow, type BrickStore } from './store'

/** Longest one preview may take, the clip included. */
export const PREVIEW_BUDGET_MS = 120_000

function store(c: ToolCtx): BrickStore {
  const b = c.env.services.bricks
  if (!b) throw new Error('Custom bricks are not available here')
  return b
}

/** A brick belongs to a channel: the agent's own (an agent of one channel never writes another channel's bricks). */
function channelOf(c: ToolCtx): number {
  const id = c.agent.channelId ?? c.channelId
  if (id === null) throw new Error('A custom brick is made for a channel: this task has none')
  return id
}

function rowOf(c: ToolCtx, raw: unknown): BrickRow {
  const id = need(raw, 'id', 40)
  const row = store(c).get(channelOf(c), id)
  if (!row) throw new Error(`No brick ${id} for this channel yet: write it with bricks_draft`)
  return row
}

const fieldsLine = (b: { fields: { name: string; type: string }[] }): string => b.fields.map((f) => `${f.name} (${f.type})`).join(', ')

export const BRICK_TOOLS: Record<string, Handler> = {
  'bricks.draft': (c, a) => {
    const input: Omit<BrickInput, 'version'> = {
      id: need(a.id, 'id', 40),
      name: need(a.name, 'name', 60),
      description: opt(a.description, 'description', 400) ?? '',
      html: need(a.html, 'html', 20_000),
      css: opt(a.css, 'css', 20_000) ?? '',
      script: opt(a.script, 'script', 20_000) ?? '',
      fields: Array.isArray(a.fields) ? (a.fields as BrickInput['fields']) : [],
      sample: isRecord(a.sample) ? (a.sample as BrickInput['sample']) : {},
      ...(isRecord(a.seconds) ? { seconds: a.seconds as BrickInput['seconds'] } : {}),
      ...(isRecord(a.use) ? { use: a.use as BrickInput['use'] } : {})
    }
    const { row, brick, changed } = store(c).draft(channelOf(c), input, { agentId: c.agent.id, taskId: c.task.id })
    const place = brick.use ? `placed in films: ${brick.use.on}, ${brick.use.seconds} s` : 'not placed in films (no use)'
    return [
      `${changed ? 'Saved' : 'Unchanged'}: ${customTemplate(brick.id)} v${row.version} « ${brick.name} » for channel #${row.channelId} (${row.state === 'approved' ? 'validated' : row.state === 'review' ? 'waiting for Charlie' : 'draft'}).`,
      `Fields: ${fieldsLine(brick)}. ${place}. Lasts ${brick.seconds.min}–${brick.seconds.max} s.`,
      `Previews used this round: ${row.tries}/${MAX_TRIES}. Next: bricks_preview {"id":"${brick.id}"} and look at the stills.`
    ].join('\n')
  },

  'bricks.preview': async (c, a) => {
    const bricks = store(c)
    const row = rowOf(c, a.id)
    if (row.tries >= MAX_TRIES) {
      throw new Error(`${customTemplate(row.slug)} was previewed ${MAX_TRIES} times this round: propose it as it is (bricks_propose, say what still fails) or ask Charlie`)
    }
    const motion = c.env.services.motion
    const browser = motion?.browser() ?? null
    if (!motion || !browser) throw new Error('No headless browser (Chromium, Chrome or Edge) on this computer: the brick cannot be previewed here')
    const aspect = a.aspect === '9:16' ? '9:16' : '16:9'
    const brick = bricks.brick(row)
    const signal = AbortSignal.any([c.signal, AbortSignal.timeout(PREVIEW_BUDGET_MS)])
    const p = await previewBrick({
      brick,
      ...(isRecord(a.values) ? { values: a.values } : {}),
      size: aspect === '9:16' ? [1080, 1920] : [1920, 1080],
      look: { accent: '#3B82F6', theme: 'dark' },
      fontCss: await motion.fontCss(),
      browser,
      media: c.env.services.media?.() ?? null,
      outDir: bricks.previewDir(row),
      signal,
      clip: a.clip !== false
    }).catch((e: unknown) => {
      if (signal.aborted && !c.signal.aborted) throw new Error(`The preview took more than ${PREVIEW_BUDGET_MS / 1000} s: make the brick lighter (fewer elements, a simpler script)`)
      throw e
    })
    const ok = p.lint.length === 0 && p.error === null
    const after = bricks.recordPreview(row.id, {
      version: row.version,
      ok,
      at: new Date(c.env.now()).toISOString(),
      aspect,
      lint: p.lint,
      stills: p.stills.map((s) => ({ share: s.share, png: s.png, jpeg: s.jpeg, coverage: s.coverage })),
      clip: p.clip
    })
    const lines = [
      `Preview of ${customTemplate(row.slug)} v${row.version} (${aspect}, ${p.seconds} s, ${Math.round(p.ms)} ms), try ${after.tries}/${MAX_TRIES} this round:`,
      ...p.stills.map((s, i) => `${i + 1}. at ${Math.round(s.share * 100)} % (${s.t.toFixed(2)} s): ${(s.coverage * 100).toFixed(1)} % of the frame drawn · ${s.jpeg ?? s.png}`),
      p.clip ? `Clip: ${p.clip}` : 'No clip.',
      ok ? 'LINT PASS: nothing overflows, the text is in the safe area, big enough and readable, no error, no network.' : `LINT FAIL (${p.lint.length}):`,
      ...p.lint.map((i) => `- FAIL ${i.rule}: ${i.message}`),
      ok
        ? 'Look at the stills: if the brick looks right, bricks_propose. Otherwise fix it with bricks_draft and preview again.'
        : `Fix it with bricks_draft, then bricks_preview again (${MAX_TRIES - after.tries} left this round).`
    ]
    const images = p.stills.filter((s) => s.jpeg !== null && existsSync(s.jpeg)).map((s) => ({ path: s.jpeg as string, mimeType: 'image/jpeg' as const }))
    return images.length ? { text: lines.join('\n'), images } : lines.join('\n')
  },

  'bricks.propose': (c, a) => {
    const bricks = store(c)
    const row = rowOf(c, a.id)
    if (row.state === 'review' && row.inboxId !== null) {
      // a turn retried after a crash: the proposal is already in the inbox
      c.waitForHuman()
      return `Already proposed: ${customTemplate(row.slug)} v${row.version} waits for Charlie (inbox #${row.inboxId}).`
    }
    if (row.state === 'approved' && row.approvedVersion === row.version) return `${customTemplate(row.slug)} v${row.version} is already validated: the channel's films can use it.`
    const pv = row.preview
    if (!pv || pv.version !== row.version) throw new Error(`Preview v${row.version} first (bricks_preview), then look at it`)
    if (!pv.ok) throw new Error(`The last preview of v${row.version} failed its lint: fix it first (${pv.lint.map((i) => i.rule).join(', ')})`)
    const brick = bricks.brick(row)
    const note = opt(a.note, 'note', 600)
    const channel = c.env.services.channels?.list().find((x) => x.id === row.channelId)
    const body = [
      `${c.agent.name} propose la brique « ${brick.name} » (${customTemplate(brick.id)} v${row.version}) pour la chaîne ${channel?.name ?? `#${row.channelId}`}.`,
      brick.description,
      `Champs : ${fieldsLine(brick)}.`,
      brick.use ? `Placement dans les vidéos : ${brick.use.on === 'start' ? 'au début' : brick.use.on === 'end' ? 'avant la fin' : 'sur chaque personne présentée'}, ${brick.use.seconds} s.` : 'Elle n’est pas placée automatiquement dans les vidéos.',
      note ? `Note de l’agent : ${note}` : '',
      `Aperçus (Production › Briques) : ${pv.stills.map((s) => s.jpeg ?? s.png).join(' ; ')}`,
      'Réponds « Valider » pour que les vidéos de la chaîne l’utilisent, ou « Refuser » avec une note pour qu’il la reprenne.'
    ].filter(Boolean)
    const item = c.env.inbox.add({ taskId: c.task.id, agentId: c.agent.id, kind: 'validate', title: `Brique à valider : ${truncate(brick.name, 120)}`, body: body.join('\n'), options: ['Valider', 'Refuser'] })
    bricks.propose(row.id, item.id)
    c.waitForHuman()
    try {
      c.env.messaging.system(c.env.messaging.conversationFor('channel', row.channelId, null), `${c.agent.name} te propose la brique « ${brick.name} » : elle t’attend dans Accueil › À valider et dans Production › Briques.`)
    } catch {
      // the chat is closing
    }
    return `Proposed ${customTemplate(brick.id)} v${row.version} to Charlie (inbox #${item.id}). Your task now waits for his answer: Valider makes it available to the channel's films; Refuser comes back with his note to revise it.`
  }
}
