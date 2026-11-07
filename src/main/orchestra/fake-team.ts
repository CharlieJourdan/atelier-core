// Fakes for the runtime's tests and the demo (never used by the app): a scripted team that answers like the agents
// would (with action blocks), and a fake `claude` child process speaking stream-json, so the real ClaudeCodeProvider
// (arguments, --resume, CLAUDE_CONFIG_DIR, the process-tree kill) runs without the CLI. No network, no model, no cost.
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import type { SpawnFn, SpawnOptions, SpawnedProcess } from '../llm/claude-code'
import type { CompletionRequest } from '../llm/types'
import { COMPACTION_MARK } from './compaction'

const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``

interface Seen {
  role: string
  channel: string | null
  kind: string
  title: string
  brief: string
  reports: { slug: string; role: string }[]
  children: string[]
  answered: boolean
}

/** Reads what the runtime's prompts say (prompt.ts) back into fields. */
export function readPrompt(system: string, prompt: string): Seen {
  const role = /\(role: ([a-z_]+)/.exec(system)?.[1] ?? 'unknown'
  const channel = /channel: ([^)]+)\)/.exec(system)?.[1] ?? null
  const reports = [...system.matchAll(/^- ([a-z0-9-]+): .+ \(([a-z_]+)\)$/gm)].map((m) => ({ slug: m[1] as string, role: m[2] as string }))
  const children = [...prompt.matchAll(/^- #\d+ .+ \[done\]: (.*)$/gm)].map((m) => m[1] as string)
  return {
    role,
    channel,
    kind: /kind: ([a-z_]+)/.exec(prompt)?.[1] ?? 'task',
    title: /^Title: (.*)$/m.exec(prompt)?.[1] ?? '',
    brief: /^Brief: (.*)$/m.exec(prompt)?.[1] ?? '',
    reports,
    children,
    answered: prompt.includes('Charlie answered your question')
  }
}

/** What the scripted team answers (deterministic). */
export function scriptedReply(system: string, prompt: string): string {
  if (prompt.startsWith(COMPACTION_MARK)) {
    return JSON.stringify({
      memories: [
        { kind: 'lesson', content: 'Leads answer faster with a precise brief and a deadline.', importance: 4 },
        { kind: 'preference', content: 'Charlie wants the weekly topics validated before scripts start.', importance: 5 }
      ],
      handover: 'Weekly topics delegated to the channel leads; waiting for their consolidated lists, then ask Charlie to validate.'
    })
  }
  const s = readPrompt(system, prompt)
  if (s.kind === 'mention') return `Bien reçu, je m'en occupe.${block([{ type: 'done', result: 'Message reçu et pris en compte.' }])}`
  if (s.kind === 'goals') return `Objectifs analysés pour ${s.channel ?? 'la chaîne'} : le brouillon tient.${block([{ type: 'done', result: 'Objectifs : le brouillon proposé tient, à confirmer par Charlie.' }])}`
  const step = /Planned step "([a-z]+)"/.exec(prompt)?.[1]
  if (step) {
    // a step of the planner (planner.ts): asks Charlie when the brief names one of his gates, else does it
    const gate = /with gate "([a-z]+)"/.exec(prompt)?.[1]
    const approved = s.answered || prompt.includes('Approved by the approval level')
    if (gate && !approved) {
      return `À valider : ${step}.` + block([{ type: 'ask_human', kind: 'validate', question: `Valider l'étape ${step} de « ${s.title} » ?`, options: ['Valider', 'Revoir'], gate }])
    }
    return `${step} : fait.` + block([{ type: 'done', result: step === 'topic' ? `Sujet : Le mystère du vol 19 (${s.channel ?? '?'})` : `Étape ${step} faite pour « ${s.title} ».` }])
  }
  if (s.kind === 'followup') return `Je relance.${block([{ type: 'done', result: 'Relance faite : le responsable suit la tâche bloquée.' }])}`
  if (s.kind === 'digest') return `Digest du jour : tout avance.${block([{ type: 'done', result: 'Digest : la file avance, rien de bloquant.' }])}`
  if (s.role === 'principal') {
    if (s.children.length === 0) {
      return (
        "Je confie les sujets de la semaine prochaine aux responsables de chaîne." +
        block([
          { type: 'delegate', role: 'channel_lead', kind: 'topics', title: "Sujets de la semaine prochaine", brief: '3 sujets par chaîne, avec angle et source' },
          { type: 'remember', kind: 'fact', content: 'Week planning starts with topics from every channel lead.', importance: 3 }
        ])
      )
    }
    if (!s.answered && s.brief.includes('[validate]')) {
      return 'Les deux chaînes ont leurs sujets.' + block([{ type: 'ask_human', kind: 'validate', question: 'Valider les sujets de la semaine prochaine ?', options: ['Valider', 'Revoir'] }])
    }
    return `Plan validé de la semaine :\n${s.children.join('\n')}` + block([{ type: 'done', result: `Plan de la semaine (${s.children.length} chaînes) prêt.` }])
  }
  if (s.role === 'channel_lead') {
    if (s.children.length === 0) {
      return `Je lance la recherche pour ${s.channel ?? 'la chaîne'}.` + block([{ type: 'delegate', role: 'researcher', kind: 'research', title: 'Trouver 3 sujets candidats', brief: 'Sujets à fort potentiel, sources vérifiables' }])
    }
    return (
      `Sujets retenus pour ${s.channel ?? 'la chaîne'}.` +
      block([
        { type: 'remember', kind: 'fact', content: `Topics shortlisted for ${s.channel ?? 'the channel'}: ${s.children.join(' / ').slice(0, 200)}`, importance: 3 },
        { type: 'done', result: `${s.channel ?? 'Chaîne'} : ${s.children.join(' / ')}` }
      ])
    )
  }
  if (s.role === 'researcher') {
    const topics = ['Le mystère du vol 19', "La ville engloutie d'Ys", 'Le trésor des Templiers'].map((t) => `${t} (${s.channel ?? '?'})`)
    return (
      topics.map((t, i) => `${i + 1}. ${t}`).join('\n') +
      block([
        { type: 'remember', kind: 'fact', content: `Researched topics: ${topics.join('; ')}`, importance: 2 },
        { type: 'done', result: topics.join(', ') }
      ])
    )
  }
  return `Fait : ${s.title}` + block([{ type: 'done', result: `Fait : ${s.title}` }])
}

/** A FakeProvider responder playing the scripted team. */
export function scriptedResponder(req: CompletionRequest): string {
  return scriptedReply(req.system ?? '', req.prompt)
}

// ---- a fake `claude -p --output-format stream-json` child process -------------------------------------------

export type FakeCliReply = { text: string } | { hang: true } | { error: string }

export interface FakeCliCall {
  pid: number
  args: string[]
  cwd: string
  configDir: string | null
  prompt: string
  /** The system prompt (read from `--system-prompt-file`). */
  system: string
  resumeId: string | null
}

export class FakeCliChild extends EventEmitter implements SpawnedProcess {
  pid: number
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  input = ''

  constructor(pid: number) {
    super()
    this.pid = pid
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (d: string) => (this.input += d))
  }

  finish(code: number): void {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code))
  }
}

/**
 * A spawn that behaves like the Claude Code CLI: reads the prompt on stdin, asks `decide` what to do, and writes the
 * init line, the answer and the result line (or an error result, or nothing at all: a hung run). `kill` stands in
 * for the platform's process-tree kill.
 */
export function fakeClaudeCli(decide: (call: FakeCliCall, index: number) => FakeCliReply) {
  const calls: FakeCliCall[] = []
  const killed: number[] = []
  const children = new Map<number, FakeCliChild>()
  let nextPid = 7000
  let sessions = 0
  const spawn: SpawnFn = (_command: string, args: string[], options: SpawnOptions) => {
    const child = new FakeCliChild(++nextPid)
    children.set(child.pid, child)
    child.stdin.on('end', () => {
      const r = args.indexOf('--resume')
      const resumeId = r >= 0 ? (args[r + 1] as string) : null
      const f = args.indexOf('--system-prompt-file')
      let system: string
      try {
        system = f >= 0 ? readFileSync(args[f + 1] as string, 'utf8') : ''
      } catch {
        system = ''
      }
      const call: FakeCliCall = {
        pid: child.pid,
        args,
        cwd: options.cwd,
        configDir: options.env.CLAUDE_CONFIG_DIR ?? null,
        prompt: child.input,
        system,
        resumeId
      }
      calls.push(call)
      const reply = decide(call, calls.length - 1)
      const model = args[args.indexOf('--model') + 1] ?? 'claude-sonnet-5-5'
      const session = resumeId ?? `fake-session-${++sessions}`
      const line = (o: unknown): void => void child.stdout.write(`${JSON.stringify(o)}\n`)
      setImmediate(() => {
        line({ type: 'system', subtype: 'init', session_id: session, model })
        if ('hang' in reply) return // never answers: only the watchdog ends it
        if ('error' in reply) {
          line({ type: 'result', subtype: 'success', is_error: true, result: reply.error, session_id: session, usage: { input_tokens: 0, output_tokens: 0 } })
          child.finish(1)
          return
        }
        line({ type: 'assistant', message: { model, content: [{ type: 'text', text: reply.text }], stop_reason: 'end_turn' } })
        line({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: reply.text,
          session_id: session,
          total_cost_usd: 0,
          usage: { input_tokens: Math.ceil(child.input.length / 4), output_tokens: Math.ceil(reply.text.length / 4) }
        })
        child.finish(0)
      })
    })
    return child
  }
  const kill = (pid: number): void => {
    killed.push(pid)
    children.get(pid)?.finish(1)
  }
  return { spawn, kill, calls, killed }
}
