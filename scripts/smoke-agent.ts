// Smoke 1: one REAL agent run through Claude Code (Charlie's subscription), outside Electron.
// Run with `npm run smoke:agent` (builds first). Costs one small real call (more only on a retry).
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { createCore } from '../src/main/core'
import { ClaudeCodeProvider, type SpawnFn } from '../src/main/llm/claude-code'
import type { CompletionRequest } from '../src/main/llm/types'
import { okTester, testCipher } from '../tests/unit/helpers'

const MCP_JS = path.resolve(__dirname, '..', 'out', 'main', 'mcp.js')

interface Check {
  name: string
  ok: boolean
  detail: string
}
const checks: Check[] = []
const check = (name: string, ok: boolean, detail = ''): void => void checks.push({ name, ok, detail })
const info: string[] = []

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-smoke-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
const out = (line: string): void => void writeSync(1, line + '\n') // vitest swallows console output of passing tests

// Tee of the CLI's stream-json output (init event, tool_use blocks, usage).
const events: Record<string, unknown>[] = []
const teeSpawn: SpawnFn = (command, args, options) => {
  const child = nodeSpawn(command, args, options) as unknown as ReturnType<SpawnFn>
  let buf = ''
  child.stdout?.on('data', (chunk: string | Buffer) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const l of lines) {
      try {
        events.push(JSON.parse(l) as Record<string, unknown>)
      } catch {
        // not JSON
      }
    }
  })
  return child
}

it('research task through the real Claude Code provider and the MCP bridge', async () => {
  check('out/main/mcp.js built', existsSync(MCP_JS), MCP_JS)
  const requests: CompletionRequest[] = []
  const real = new ClaudeCodeProvider({ spawn: teeSpawn })
  check('claude binary found', real.binaryPath() !== null)
  const spy = Object.assign(Object.create(real) as ClaudeCodeProvider, {
    stream: (req: CompletionRequest, o?: Parameters<ClaudeCodeProvider['stream']>[1]) => {
      requests.push(req)
      return real.stream(req, o)
    }
  })

  const core = createCore({
    paths: { userData: tmp },
    cipher: testCipher(),
    tester: okTester,
    chatProvider: () => spy,
    // The app passes Electron's binary; the runner adds ELECTRON_RUN_AS_NODE=1, which plain node ignores.
    agentMcp: { command: process.execPath, args: [MCP_JS] },
    retryDelayMs: 0
  })
  try {
    await core.bridgeReady
    const wf = core.context.workflow
    await core.api['routes.set']('researcher', { tier: 'fast', providerId: 'claude-code' })
    const channel = wf.channels.create({ name: 'Smoke History' })
    const { video } = wf.createVideo(channel.id, {
      title: 'The Tunguska event, 1908',
      brief:
        'A 1-minute video on the 1908 Tunguska explosion in Siberia. Short brief: what happened, the leading theory (airburst), why it matters. No web search needed; keep the research under 200 words. Before saving the research, post one short progress note to the chat with post_message.'
    })
    const task = wf.listTasks({ videoId: video.id }).find((t) => wf.getDeliverable(t.deliverableId as number).type === 'research')!

    const started = core.runner.tick()
    check('runner started the research task', started.includes(task.id), `started=${started.join(',')}`)
    await core.runner.idle()

    const after = wf.getTask(task.id)
    check('task finished (not failed)', after.status !== 'failed' && after.status !== 'running', `status=${after.status} err=${after.lastError ?? ''}`)

    // ---- the CLI's own view
    const init = events.find((e) => e.type === 'system' && e.subtype === 'init')
    const tools = (init?.tools as string[] | undefined) ?? []
    const mcpServers = (init?.mcp_servers as { name: string; status: string }[] | undefined) ?? []
    info.push(`init event keys: ${Object.keys(init ?? {}).join(', ')}`)
    info.push(`init memory_paths (paths only): ${JSON.stringify(init?.memory_paths ?? null)}`)
    info.push(`tools the CLI saw (${tools.length}): ${tools.join(', ')}`)
    info.push(`mcp servers: ${mcpServers.map((s) => `${s.name}=${s.status}`).join(', ')}`)
    check('CLI saw the Atelier tools', tools.includes('mcp__atelier__save_version') && tools.includes('mcp__atelier__get_brief'))
    check('atelier MCP server connected', mcpServers.some((s) => s.name === 'atelier' && s.status === 'connected'))
    const builtin = tools.filter((t) => !t.startsWith('mcp__'))
    check('only WebSearch as built-in tool', builtin.every((t) => t === 'WebSearch'), `built-in: ${builtin.join(',') || 'none'}`)
    check('no foreign MCP server', mcpServers.every((s) => s.name === 'atelier'))

    // ---- the tool calls really made through the bridge
    const toolUses: { name: string; input: Record<string, unknown>; id: string }[] = []
    const toolResults = new Map<string, boolean>()
    for (const e of events) {
      const content = ((e.message as { content?: unknown } | undefined)?.content ?? []) as Record<string, unknown>[]
      if (!Array.isArray(content)) continue
      for (const b of content) {
        if (e.type === 'assistant' && b.type === 'tool_use')
          toolUses.push({ name: String(b.name), input: (b.input ?? {}) as Record<string, unknown>, id: String(b.id) })
        if (e.type === 'user' && b.type === 'tool_result') toolResults.set(String(b.tool_use_id), b.is_error === true)
      }
    }
    info.push(`tool calls: ${toolUses.map((t) => `${t.name}${toolResults.get(t.id) ? '(error)' : ''}`).join(', ')}`)
    const save = toolUses.find((t) => t.name === 'mcp__atelier__save_version')
    check('agent called save_version via MCP', !!save && toolResults.get(save.id) === false)
    const post = toolUses.find((t) => t.name === 'mcp__atelier__post_message')
    check('agent called post_message via MCP', !!post && toolResults.get(post.id) === false)

    // ---- the deliverable and the chat
    const dRow = wf.listDeliverables(video.id).find((d) => d.type === 'research')!
    const versions = wf.listVersions(dRow.id)
    check('research has a version', versions.length >= 1, `versions=${versions.length} status=${dRow.status}`)
    const v1 = versions[0]
    const savedText = String(save?.input.content ?? '').trim()
    check('version content is the save_version payload (not a fallback)', !!v1 && savedText.length > 50 && v1.content === savedText, `chars=${v1?.content?.length ?? 0}`)
    check('version author researcher + cost > 0', v1?.author === 'researcher' && (v1?.costUsd ?? 0) > 0, `cost=$${v1?.costUsd}`)
    const msgs = await core.api['chat.messages'](core.chat.store.open({ kind: 'video', videoId: video.id }).id)
    const posted = String(post?.input.text ?? '').trim()
    check('post_message text is in the video conversation', posted.length > 0 && msgs.some((m) => m.authorType === 'agent' && m.body.trim() === posted))
    const rows = core.db.prepare('SELECT status, amount_usd, model FROM ledger WHERE task_id = ?').all(task.id) as {
      status: string
      amount_usd: number
      model: string
    }[]
    check('ledger: one settled entry with non-zero cost', rows.length === 1 && rows[0]!.status === 'settled' && rows[0]!.amount_usd > 0, JSON.stringify(rows))
    check('runner posted its own messages in the video conversation', msgs.some((m) => m.authorType === 'agent' && /Starting the research/i.test(m.body)) && msgs.some((m) => m.card?.type === 'approval' || /research v1 is done/i.test(m.body)), `${msgs.length} messages`)
    const result = events.find((e) => e.type === 'result')
    info.push(`CLI reported cost: $${String(result?.total_cost_usd)}; Atelier ledger: $${rows[0]?.amount_usd}; model ${rows[0]?.model}; turns ${String(result?.num_turns)}`)
    info.push(`research version: ${v1?.content?.length ?? 0} chars (content not printed)`)

    // ---- was ~/.claude/CLAUDE.md loaded despite --setting-sources ""? (sizes only, never content)
    const claudeMd = path.join(os.homedir(), '.claude', 'CLAUDE.md')
    const mdBytes = existsSync(claudeMd) ? statSync(claudeMd).size : 0
    const usage = (events.find((e) => e.type === 'assistant')?.message as { usage?: Record<string, number> } | undefined)?.usage ?? {}
    const promptTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
    const req = requests[0]!
    const ours = Math.round((req.system!.length + req.prompt.length + JSON.stringify(req.tools?.specs ?? []).length) / 4)
    info.push(`~/.claude/CLAUDE.md: ${mdBytes} bytes (~${Math.round(mdBytes / 4)} tokens)`)
    info.push(`first call input tokens: ${promptTokens}; Atelier system+prompt+tool schemas ~${ours} tokens; unexplained ~${promptTokens - ours}`)
    check('init event does not reference CLAUDE.md', !/CLAUDE\.md/i.test(JSON.stringify(init ?? {})))
  } finally {
    core.close()
  }
})

it('summary', () => {
  const pass = checks.length > 0 && checks.every((c) => c.ok)
  out(`
===== SMOKE AGENT: ${pass ? 'PASS' : 'FAIL'} =====`)
  for (const c of checks) out(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` - ${c.detail}` : ''}`)
  for (const l of info) out(`INFO  ${l}`)
  expect(checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([])
})
