// The pipeline tools (decision 0024, R10.3): the edit operations as tools the model calls — read the pipeline, try a batch
// (the diff, Δ cost, Δ fit, or typed errors; nothing saved), propose a batch to the owner. The same three tools serve the
// pipeline's own agent (the conversation in the pipeline editor), the agent drafting a proposal (its variants) and the team
// agents of the runtime (orchestra technologies `pipeline.read|try|propose`, src/main/orchestra/technologies.ts). Providers
// without tools (the API key, Codex) get the same contract as a fenced block in their answer (`parseOpsBlock`).
import type { AgentTools, ToolCallResult, ToolSpec } from '../../llm/types'
import type { EditIssue } from '../../../engine/technologies'
import type { TriedEdit } from '../../../engine/technologies/pipeline-diff'

/** One line per edit operation, for tool descriptions and prompts. */
export const OPS_HELP =
  'Edit operations (JSON objects, field `op`): setMix {kind: presenter|clipAi|imageAi|stock|archive|userFootage|motion, share 0..1} or {mix: {shares…, curve}}; ' +
  'setCurve {curve: "flat"|"hook-heavy"}; ' +
  'setMix {mix: {…shares, curve, budget: {maxCredits | maxCreditsPerMinute, saveFirst: "end"|"body"|"even", protect: ["hook"|"setup"|"body"|"outro"], floors: {presenter, clipAi}}}} gives a video a budget instead of a fixed curve ' +
  '(the presenter / clip / still shares per part of the video are then made for its length, from the end backwards, and priced: show the owner the price and what changes per part); ' +
  'setOption {option, value} (only the options the pipeline declares, never one marked soon); ' +
  'setEngine {brick, engine} and setFallbacks {brick, fallbacks: [engine ids]} (engine ids of the brick’s family, e.g. image:gpt-image-25-medium); ' +
  'setStyle {brick, style}; addBrick {tech: "name@version", after?}; removeBrick {brick}; moveBrick {brick, after: brick|null}; ' +
  'setSetting {brick, key, value (null removes)}; setGate {checkpoint, on} or {checkpoints: [...] | null}; setInput {input, source: "project"|"channel"|{fixed}}; ' +
  'setCap {capCredits | null}; rename {name}. A brick is named by its technology without the version (avatar.speak, visuals.fulfil). ' +
  'Prefer options over engines: quality lives in the options quality.images / quality.presenter (eco, standard, premium) and clipShare (0..0.5).'

const OPS_SCHEMA = { type: 'array', description: 'The batch of edit operations, applied in order (all or nothing).', items: { type: 'object' } }
const VARIANT = { type: 'string', enum: ['faithful', 'cheap', 'premium'], description: 'Which variant of the proposal.' }

export const PIPELINE_TOOL_NAMES = ['pipeline_read', 'pipeline_try', 'pipeline_propose'] as const
export type PipelineToolName = (typeof PIPELINE_TOOL_NAMES)[number]

export const PIPELINE_TOOL_HELP: Record<PipelineToolName, string> = {
  pipeline_read:
    'Read the pipeline: format, mix, every option with its value and its choices, the bricks with engine / fallbacks / style / settings, inputs, gates, cap, and its cost per finished minute (credits, min / avg / max) and fit % to the channel.',
  pipeline_try: `Try a batch of edit operations WITHOUT saving: returns what changes, the cost per minute before / after and the fit % before / after, or typed errors (code, operation index). ${OPS_HELP}`,
  pipeline_propose:
    'Propose a batch of edit operations to the owner (validated like pipeline_try). They see it as a diff with Δ cost and Δ fit and accept it (a new version) or not; it replaces the change waiting. note: one short French sentence saying what it does.'
}

/** Where the tools act: the pipeline of a conversation, a proposal's variants, or a team pipeline by id. */
export type BenchTarget = { variant?: string; pipeline?: number }

export interface Workbench {
  read(at: BenchTarget): string
  tryOps(at: BenchTarget, ops: unknown[]): TriedEdit | { ok: false; errors: EditIssue[] }
  /** Stages the batch; returns what the model is told (the change id), or the typed errors. */
  propose(at: BenchTarget, ops: unknown[], note: string): { ok: true; text: string } | { ok: false; errors: EditIssue[] }
}

/** The JSON schema of a tool; `withTarget`: the proposal's `variant`, or the team's `pipeline` id. */
export function pipelineToolSpec(name: PipelineToolName, target: 'none' | 'variant' | 'pipeline'): ToolSpec {
  const where: Record<string, unknown> =
    target === 'variant' ? { variant: VARIANT } : target === 'pipeline' ? { pipeline: { type: 'integer', description: 'Id of the team pipeline.' } } : {}
  const required = target === 'none' ? [] : [target]
  const props: Record<string, unknown> =
    name === 'pipeline_read' ? where : name === 'pipeline_try' ? { ...where, ops: OPS_SCHEMA } : { ...where, ops: OPS_SCHEMA, note: { type: 'string', description: 'What it does, one French sentence.' } }
  const req = name === 'pipeline_read' ? required : [...required, 'ops']
  return { name, description: PIPELINE_TOOL_HELP[name], inputSchema: { type: 'object', properties: props, ...(req.length ? { required: req } : {}), additionalProperties: false } }
}

const round = (x: number): number => Math.round(x * 100) / 100

/** A tried batch as the model reads it. */
export function triedText(r: TriedEdit | { ok: false; errors: EditIssue[] }): string {
  if (!r.ok) return `Refused (nothing changed): ${r.errors.map((e) => `[${e.code}] operation ${e.op + 1}: ${e.message}`).join('; ')}`
  const cost = r.perMinute ? `credits per minute avg ${round(r.perMinute.before.avg)} → ${round(r.perMinute.after.avg)} (min ${round(r.perMinute.after.min)}, max ${round(r.perMinute.after.max)})` : 'no price known'
  const fit = r.fit.before === null && r.fit.after === null ? 'fit unknown (no measured channel)' : `fit ${r.fit.before ?? '?'} % → ${r.fit.after ?? '?'} %`
  const changes = r.changes.map((c) => `${c.kind}${c.brick ? ` ${c.brick}` : ''}${c.key ? ` ${c.key}` : ''}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`)
  return [changes.length ? `Changes:\n- ${changes.join('\n- ')}` : 'Nothing changes.', cost, fit].join('\n')
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function targetOf(args: Record<string, unknown>): BenchTarget {
  return {
    ...(typeof args.variant === 'string' ? { variant: args.variant } : {}),
    ...(typeof args.pipeline === 'number' && Number.isInteger(args.pipeline) ? { pipeline: args.pipeline } : {})
  }
}

/** Runs one pipeline tool on a workbench. Never throws: problems go back to the model as tool errors. */
export function callPipelineTool(bench: Workbench, name: string, raw: unknown): ToolCallResult {
  const args = isRecord(raw) ? raw : {}
  const at = targetOf(args)
  try {
    if (name === 'pipeline_read') return { text: bench.read(at), isError: false }
    if (!Array.isArray(args.ops) || args.ops.length === 0 || args.ops.length > 50) return { text: 'ops: a list of 1 to 50 edit operations', isError: true }
    if (name === 'pipeline_try') {
      const r = bench.tryOps(at, args.ops)
      return { text: triedText(r), isError: !r.ok }
    }
    if (name === 'pipeline_propose') {
      const note = typeof args.note === 'string' ? args.note.slice(0, 500) : ''
      const r = bench.propose(at, args.ops, note)
      return r.ok ? { text: r.text, isError: false } : { text: triedText(r), isError: true }
    }
    return { text: `no tool ${name}`, isError: true }
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true }
  }
}

/** The three tools on a workbench, for a model request (in-process call; the MCP bridge reaches the same `call`). */
export function benchTools(bench: Workbench, target: 'none' | 'variant'): AgentTools {
  return { specs: PIPELINE_TOOL_NAMES.map((n) => pipelineToolSpec(n, target)), webSearch: false, call: async (n, a) => callPipelineTool(bench, n, a) }
}

/**
 * The fenced block a model without tools ends its answer with: ```atelier-ops {"ops": [...], "note": "..."}``` (a
 * conversation) or ```atelier-proposal {"summary", "why", "ops"}``` (a proposal). Returns the parsed object and the text
 * without the block; a broken block is reported, never thrown.
 */
export function parseFenced(text: string, tag: 'atelier-ops' | 'atelier-proposal'): { text: string; block: Record<string, unknown> | null; broken: boolean } {
  const re = new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)```', 'm')
  const m = re.exec(text)
  if (!m) return { text: text.trim(), block: null, broken: false }
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim()
  try {
    const v = JSON.parse(m[1] ?? '') as unknown
    return isRecord(v) ? { text: rest, block: v, broken: false } : { text: rest, block: null, broken: true }
  } catch {
    return { text: rest, block: null, broken: true }
  }
}
