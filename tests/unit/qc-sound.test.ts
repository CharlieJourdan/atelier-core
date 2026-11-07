// The team's quality check listens: qc.check of a run reports silence, loudness and the render review's voice holes / clicks /
// music level (decision 0086) from the QC node's own report, and says plainly when the sound was not verified (#110).
import { describe, expect, it } from 'vitest'
import { WORK_TOOLS } from '../../src/main/orchestra/tools-work'

const node = (type: string, nodeId: string) => ({ nodeId, type, state: 'done' })
const run = (nodes: unknown[]) => ({ id: 7, channelId: 1, videoTitle: 'V', topic: 'T', status: 'succeeded', waitingNodes: [], progress: 1, spentCredits: 1, quoteCredits: 1, demo: false, error: null, videoFileRef: 'f', nodes })

function ctx(r: unknown, output: unknown) {
  return { agent: { channelId: 1 }, env: { services: { production: { get: () => r, output: async () => output } } } } as never
}
const report = (checks: unknown[]) => ({ kind: 'json', nodeId: 'qc', outputs: { report: { type: 'json.qc', value: { checks }, files: [] } } })

describe('qc.check of a run: the sound', () => {
  it('lists silence, loudness and what the edit review left of voice holes, clicks and music level', async () => {
    const out = (await WORK_TOOLS['qc.check']!(
      ctx(run([node('qc.check@1', 'qc')]), report([
        { id: 'silence', status: 'ok', detail: 'Pas de silence.', data: {} },
        { id: 'loudness', status: 'warn', detail: 'Volume faible.', data: {} },
        { id: 'edit', status: 'warn', detail: 'x', data: { kinds: ['audio_dropout', 'music_loud', 'map_legend'] } }
      ])),
      { run: 7 }
    )) as string
    expect(out).toContain('PASS silence')
    expect(out).toContain('WARN loudness: Volume faible.')
    expect(out).toContain('WARN sound review')
    expect(out).toContain('audio_dropout, music_loud')
    expect(out).not.toContain('map_legend')
    expect(out).not.toContain('not verified')
  })

  it('says the sound was not verified when there is no QC report', async () => {
    const out = (await WORK_TOOLS['qc.check']!(ctx(run([]), null), { run: 7 })) as string
    expect(out).toContain('sound: not verified')
    expect(out).toContain('eyes.watchVideo')
  })
})
