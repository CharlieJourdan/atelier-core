// Custom bricks (« briques sur mesure », docs/ENGINE-SPEC.md §25.2): a motion template written for ONE channel by an agent, kept as DATA
// (an HTML fragment, its CSS, a small animation script and a declared field schema), never as code of the app. It is only ever run inside the
// headless browser of `motion.render`, in a sandboxed page (motion/brick-page.ts: strict CSP with a nonce, no network, no Node, a time budget
// per frame). This file is the contract: the brick's zod schema, the schema of its values (built from its fields), the static checks run
// before anything is drawn, the placement the director may use, and the content hash that keys the render cache.
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const CUSTOM_PREFIX = 'custom:'
/** A brick id: lowercase letters, digits and dashes (it is part of folder names and of `custom:<id>`). */
export const BRICK_ID = /^[a-z0-9][a-z0-9-]{1,39}$/
export const CustomTemplateId = z.string().regex(/^custom:[a-z0-9][a-z0-9-]{1,39}$/, 'a custom template is custom:<id>')
export const customTemplate = (id: string): string => `${CUSTOM_PREFIX}${id}`
export const isCustomTemplate = (t: unknown): t is string => typeof t === 'string' && t.startsWith(CUSTOM_PREFIX)
export const brickIdOf = (template: string): string => template.slice(CUSTOM_PREFIX.length)

/** Longest data: URI an image field takes (about 450 KB of picture). */
export const IMAGE_MAX_CHARS = 600_000
const IMAGE_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
const HEX = /^#[0-9a-fA-F]{6}$/

/** A field name: it is written `{{name}}` in the HTML and read as `brick.values.name` in the script. */
const FieldName = z.string().regex(/^[a-z][a-zA-Z0-9]{0,23}$/, 'a field name is a short camelCase word')
const Label = z.string().trim().max(60).optional()

export const BrickField = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), name: FieldName, label: Label, max: z.number().int().min(1).max(300), optional: z.boolean().default(false), default: z.string().max(300).optional() }),
  z.object({
    type: z.literal('number'),
    name: FieldName,
    label: Label,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    optional: z.boolean().default(false),
    default: z.number().finite().optional()
  }),
  z.object({ type: z.literal('color'), name: FieldName, label: Label, optional: z.boolean().default(false), default: z.string().regex(HEX).optional() }),
  z.object({ type: z.literal('image'), name: FieldName, label: Label, optional: z.boolean().default(false) })
])
export type BrickField = z.infer<typeof BrickField>

export const BrickValue = z.union([z.string().max(IMAGE_MAX_CHARS), z.number().finite()])
export type BrickValue = z.infer<typeof BrickValue>
export type BrickValues = Record<string, BrickValue>

/**
 * Where the director may place the brick in a film of the channel: over the first seconds (instead of the title card), before the end
 * (a subscribe reminder), or on each person the narration names with a role (a character card), the person's name and role going into
 * the fields `bind` names. Every other field takes its default.
 */
export const BrickUse = z.object({
  on: z.enum(['start', 'end', 'person']),
  seconds: z.number().min(1).max(20),
  bind: z.object({ name: FieldName.optional(), role: FieldName.optional() }).default({}),
  /** At most this many in one film. */
  max: z.number().int().min(1).max(6).default(1)
})
export type BrickUse = z.infer<typeof BrickUse>

const BrickBase = z.object({
  id: z.string().regex(BRICK_ID, 'a brick id is lowercase letters, digits and dashes (2 to 40)'),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(400).default(''),
  version: z.number().int().min(1),
  /** The markup of the graphic (no script, no link, no network); `{{field}}` is replaced by the field's value, escaped. */
  html: z.string().min(1).max(20_000),
  css: z.string().max(20_000).default(''),
  /** Optional: sets `brick.render = function (t) {…}`, called at every frame after the runtime's own presets. */
  script: z.string().max(20_000).default(''),
  fields: z.array(BrickField).min(1).max(12),
  /** The values of the previews (the agent's sample). */
  sample: z.record(z.string(), BrickValue),
  /** How long it may stay on screen (seconds). */
  seconds: z.object({ min: z.number().min(0.5).max(30), max: z.number().min(0.5).max(30) }).default({ min: 2, max: 8 }),
  use: BrickUse.optional()
})

export const Brick = BrickBase.superRefine((b, ctx) => {
  const names = new Set<string>()
  b.fields.forEach((f, i) => {
    if (names.has(f.name)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'name'], message: `field ${f.name} is declared twice` })
    names.add(f.name)
    if (f.type === 'number' && f.min !== undefined && f.max !== undefined && f.min > f.max) ctx.addIssue({ code: 'custom', path: ['fields', i], message: 'min is above max' })
  })
  if (b.seconds.min > b.seconds.max) ctx.addIssue({ code: 'custom', path: ['seconds'], message: 'min is above max' })
  const sample = valuesSchema(b.fields).safeParse(withDefaults(b.fields, b.sample))
  if (!sample.success) for (const i of sample.error.issues) ctx.addIssue({ code: 'custom', path: ['sample', ...i.path.map(String)], message: i.message })
  if (b.use) {
    if (b.use.seconds < b.seconds.min || b.use.seconds > b.seconds.max) ctx.addIssue({ code: 'custom', path: ['use', 'seconds'], message: `outside the brick's ${b.seconds.min}–${b.seconds.max} s` })
    for (const [k, name] of Object.entries(b.use.bind)) {
      const f = b.fields.find((x) => x.name === name)
      if (name !== undefined && (!f || f.type !== 'text')) ctx.addIssue({ code: 'custom', path: ['use', 'bind', k], message: `${String(name)} is not a text field` })
    }
    if (b.use.on === 'person' && !b.use.bind.name) ctx.addIssue({ code: 'custom', path: ['use', 'bind', 'name'], message: 'a person brick says which field takes the name' })
    const bound = new Set(Object.values(b.use.bind))
    for (const f of b.fields) {
      if (!bound.has(f.name) && f.type !== 'image' && !f.optional && f.default === undefined) ctx.addIssue({ code: 'custom', path: ['fields'], message: `${f.name} needs a default: the director fills only ${[...bound].join(', ') || 'no field'}` })
      if (f.type === 'image' && !f.optional && !bound.has(f.name)) ctx.addIssue({ code: 'custom', path: ['fields'], message: `${f.name} is an image without a default: make it optional to place the brick in films` })
    }
  }
})
export type Brick = z.infer<typeof Brick>
export type BrickInput = z.input<typeof Brick>

/** The defaults of the fields under the given values (a value given wins). */
export function withDefaults(fields: readonly BrickField[], values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = values[f.name]
    if (v !== undefined && v !== null && v !== '') out[f.name] = v
    else if ('default' in f && f.default !== undefined) out[f.name] = f.default
  }
  for (const [k, v] of Object.entries(values)) if (!(k in out) && !fields.some((f) => f.name === k)) out[k] = v
  return out
}

/** The zod schema of a brick's values: one key per field, nothing else, every limit of the field. */
export function valuesSchema(fields: readonly BrickField[]): z.ZodType<BrickValues> {
  const shape: Record<string, z.ZodType> = {}
  for (const f of fields) {
    let s: z.ZodType
    if (f.type === 'text') s = z.string().trim().min(1).max(f.max)
    else if (f.type === 'number') {
      let n = z.number().finite()
      if (f.min !== undefined) n = n.min(f.min)
      if (f.max !== undefined) n = n.max(f.max)
      s = n
    } else if (f.type === 'color') s = z.string().regex(HEX, 'a colour is #RRGGBB')
    else s = z.string().max(IMAGE_MAX_CHARS).regex(IMAGE_URI, 'an image is a data:image/png, jpeg or webp URI (no address: bricks have no network)')
    shape[f.name] = f.optional ? s.optional() : s
  }
  return z.strictObject(shape) as unknown as z.ZodType<BrickValues>
}

/** The values a brick is drawn with: defaults filled, checked against its fields. Problems name the brick and the field. */
export function resolveValues(brick: Pick<Brick, 'id' | 'fields'>, values: Readonly<Record<string, unknown>>): { ok: true; values: BrickValues } | { ok: false; problems: string[] } {
  const r = valuesSchema(brick.fields).safeParse(withDefaults(brick.fields, values))
  if (r.success) return { ok: true, values: r.data }
  return { ok: false, problems: r.error.issues.map((i) => `custom:${brick.id}: ${i.path.join('.') || 'values'} ${i.message}`) }
}

// ---- static checks (before a page is ever opened; the CSP and the blocked network are the real walls) -------------------------------------

const HTML_RULES: [RegExp, string][] = [
  [/<\s*\/?\s*(script|iframe|frame|frameset|object|embed|link|meta|base|form|portal|style|template|noscript)\b/i, 'the HTML may not hold <script>, <iframe>, <object>, <embed>, <link>, <meta>, <base>, <form> or <style> (put the CSS in css and the code in script)'],
  [/\son[a-z]+\s*=/i, 'the HTML may not hold event handlers (on…=): animate in script with brick.render'],
  [/javascript\s*:/i, 'javascript: addresses are not allowed'],
  [/\b(https?|wss?|ftp|file)\s*:|(src|href|srcset|poster|action|data)\s*=\s*["']?\s*\/\//i, 'bricks have no network: no web address (embed a picture as an image field)'],
  [/\bsrcset\s*=/i, 'srcset is not allowed (use one image field)']
]
const CSS_RULES: [RegExp, string][] = [
  [/<\s*\/?\s*style/i, 'the CSS may not close its <style>'],
  [/@import/i, 'the CSS may not @import anything'],
  [/url\(\s*(?!["']?\s*data:)/i, 'the CSS may only use data: URLs (bricks have no network)'],
  [/expression\s*\(|behavior\s*:|-moz-binding/i, 'this CSS construct is not allowed']
]
const SCRIPT_RULES: [RegExp, string][] = [
  [/<\s*\/?\s*script|<!--/i, 'the script may not hold <script or <!--'],
  [/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\bimportScripts\b|\bWorker\s*\(/, 'no eval, Function, import() or workers'],
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|\bwindow\.open\b|\blocation\s*[.=]/, 'bricks have no network'],
  [/\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b|\bDate\.now\b|\bnew\s+Date\b|\bperformance\.now\b/, 'a frame is a function of t only: no timers, no clock (use brick.render(t))'],
  [/\bMath\.random\b/, 'no Math.random: use brick.random(), seeded, so a frame is always the same'],
  [/\bdocument\.write\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/, 'no document.write and no storage']
]

/** What is wrong with a brick before it is drawn (empty = it may be drawn). In English, naming the part. */
export function staticProblems(b: Pick<Brick, 'html' | 'css' | 'script' | 'fields'>): string[] {
  const out: string[] = []
  for (const [re, why] of HTML_RULES) if (re.test(b.html)) out.push(`html: ${why}`)
  for (const [re, why] of CSS_RULES) if (re.test(b.css)) out.push(`css: ${why}`)
  for (const [re, why] of SCRIPT_RULES) if (re.test(b.script)) out.push(`script: ${why}`)
  const names = new Set(b.fields.map((f) => f.name))
  for (const m of b.html.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) if (!names.has(m[1] as string)) out.push(`html: {{${m[1]}}} is not one of the fields`)
  return [...new Set(out)]
}

/** The content hash of a brick (its id, version, markup, style, script, fields and limits): part of the render cache key. */
export function brickHash(b: Pick<Brick, 'id' | 'version' | 'html' | 'css' | 'script' | 'fields' | 'seconds'>): string {
  const doc = JSON.stringify([b.id, b.version, b.html, b.css, b.script, b.fields, b.seconds])
  return createHash('sha256').update(doc).digest('hex').slice(0, 32)
}

/** What the director needs of a brick to place it (no markup): its template id, fields, limits and placement. */
export const BrickPlacement = z.object({
  template: CustomTemplateId,
  name: z.string().min(1).max(60),
  version: z.number().int().min(1),
  fields: z.array(BrickField).min(1).max(12),
  seconds: z.object({ min: z.number(), max: z.number() }),
  use: BrickUse
})
export type BrickPlacement = z.infer<typeof BrickPlacement>

export function placementOf(b: Brick): BrickPlacement | null {
  return b.use ? { template: customTemplate(b.id), name: b.name, version: b.version, fields: b.fields, seconds: b.seconds, use: b.use } : null
}
