import { describe, expect, it } from 'vitest'
import { StreamJsonParser, type ParsedEvent } from '../../src/main/llm/stream-json'
import { fixture } from './helpers'

// recording (scrubbed: placeholder ids, paths and usage): claude 2.1.303, haiku, prompt "Reply with the word ok" (11 lines).
const FIXTURE = fixture('claude-stream.jsonl')
const LINES = FIXTURE.split('\n').filter(Boolean)
const SESSION = '00000000-0000-4000-8000-000000000001'
// Positions of the recorded lines.
const INIT = 0
const STATUS = 1
const DELTA = 4
const ASSISTANT = 5
const RATE_LIMIT = 9
const RESULT = 10

/** SYNTHETIC: a text_delta line shaped like the recorded one, with other text. */
const synthDelta = (text: string): string => (LINES[DELTA] as string).replace('"text":"ok"', `"text":${JSON.stringify(text)}`)
/** SYNTHETIC: the recorded stream with its single delta replaced by several deltas. */
const synthMulti = (...texts: string[]): string[] => [...LINES.slice(0, DELTA), ...texts.map(synthDelta), ...LINES.slice(DELTA + 1)]
const join = (lines: string[]): string => lines.join('\n') + '\n'

function parseAll(chunks: string[]): ParsedEvent[] {
  const p = new StreamJsonParser()
  return [...chunks.flatMap((c) => p.push(c)), ...p.end()]
}

const textsOf = (events: ParsedEvent[]): string[] => events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)

describe('stream-json parser', () => {
  it('turns the recorded fixture into init, one text delta and one result', () => {
    const events = parseAll([FIXTURE])
    expect(events[0]).toEqual({ type: 'init', sessionId: SESSION, model: 'claude-haiku-5-5' })
    // The assistant snapshot duplicates the delta and must not be emitted twice.
    expect(textsOf(events)).toEqual(['ok'])
    expect(events).toHaveLength(3)
    expect(events.at(-1)).toEqual({
      type: 'result',
      isError: false,
      errorMessage: null,
      result: {
        text: 'ok',
        model: 'claude-haiku-5-5',
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 1000 },
        costUsd: 0.001234,
        stopReason: 'end_turn',
        sessionId: SESSION
      }
    })
  })

  it('ignores the recorded system/status and rate_limit_event lines', () => {
    const p = new StreamJsonParser()
    expect(p.push(LINES[STATUS] + '\n')).toEqual([])
    expect(p.push(LINES[RATE_LIMIT] + '\n')).toEqual([])
    expect(p.badLines).toEqual([])
  })

  it('gives the same events whatever the chunking (byte by byte, CRLF)', () => {
    const whole = parseAll([FIXTURE])
    expect(parseAll(FIXTURE.split(''))).toEqual(whole)
    expect(parseAll([FIXTURE.replace(/\n/g, '\r\n')])).toEqual(whole)
    // Trailing line without newline is flushed by end().
    expect(parseAll([FIXTURE.trimEnd()])).toEqual(whole)
  })

  it('streams several text deltas in order (synthetic deltas on the recorded envelope)', () => {
    const input = join(synthMulti('Three video', ' ideas about ', 'lost cities'))
    const events = parseAll([input])
    // The recorded snapshot says "ok": it must not leak in once deltas were streamed.
    expect(textsOf(events)).toEqual(['Three video', ' ideas about ', 'lost cities'])
    expect(parseAll(input.split(''))).toEqual(events)
  })

  it('emits text from full assistant messages when partial messages are off', () => {
    // Without --include-partial-messages there are no stream_event lines: init, one full assistant message, result.
    const events = parseAll([join([LINES[INIT] as string, LINES[ASSISTANT] as string, LINES[RESULT] as string])])
    expect(textsOf(events)).toEqual(['ok'])
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { text: 'ok', stopReason: 'end_turn' } })
  })

  it('never re-emits snapshot text once deltas were streamed', () => {
    // SYNTHETIC: a second, complete snapshot with different text arrives after the deltas.
    const full = (LINES[ASSISTANT] as string).replace('"text":"ok"', '"text":"A longer complete answer"')
    const lines = synthMulti('A longer ', 'complete answer')
    lines.splice(lines.length - 1, 0, full)
    const events = parseAll([join(lines)])
    expect(textsOf(events)).toEqual(['A longer ', 'complete answer'])
  })

  it('ignores events from Task subagents (parent_tool_use_id set)', () => {
    const sub = JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_sub', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'SUBAGENT NOISE' }] },
      parent_tool_use_id: 'toolu_01abc',
      session_id: 's'
    })
    const subDelta = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'MORE NOISE' } },
      parent_tool_use_id: 'toolu_01abc'
    })
    const events = parseAll([join([LINES[0] as string, sub, subDelta, ...LINES.slice(1)])])
    expect(textsOf(events)).toEqual(['ok'])
  })

  it('reports error results and skips junk lines', () => {
    const p = new StreamJsonParser()
    const events = [
      ...p.push('not json\n'),
      ...p.push('[1,2]\n'),
      ...p.push('{"type":"something_new","x":1}\n'),
      ...p.push('{"type":"result","subtype":"error_max_turns","is_error":true,"session_id":"s","total_cost_usd":0.01,"usage":{"input_tokens":5,"output_tokens":0}}\n')
    ]
    expect(p.badLines).toEqual(['not json', '[1,2]'])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorMessage: 'error_max_turns',
      result: { costUsd: 0.01, usage: { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    })
  })
})
