// Real mode, Planning › publication kit: which run holds the package, and the description as it goes on YouTube.
import { describe, expect, it } from 'vitest'
import { hasThumbnail, packageDescription, packageRunOf, type LivePackage } from '../../src/renderer/screens/planning/livePackage'
import type { ProtoVideo } from '../../src/renderer/proto/types'

const video = (state: 'done' | 'running' | 'cached' | null): ProtoVideo =>
  ({ id: 'vid-1', liveRun: state === null ? undefined : { runId: 7, demo: true, nodes: [{ nodeId: 'render', state: 'done', progress: 1 }, { nodeId: 'package', state, progress: 1 }] } }) as unknown as ProtoVideo

describe('publication kit in real mode', () => {
  it('reads the package only once its node is done (or cached)', () => {
    expect(packageRunOf(video('done'))).toBe(7)
    expect(packageRunOf(video('cached'))).toBe(7)
    expect(packageRunOf(video('running'))).toBeNull()
    expect(packageRunOf(video(null))).toBeNull()
    expect(packageRunOf(undefined)).toBeNull()
  })

  it('the thumbnail button needs thumbnail.png in the package files', () => {
    const file = (name: string) => ({ ref: `r-${name}`, name, size: 10, mime: 'image/png' })
    const pkg = (names: string[]) => ({ kind: 'package', nodeId: 'package', title: 't', alternatives: [], description: '', chapters: [], tags: [], files: names.map(file), folder: 'C:/out/pkg', demo: true }) satisfies LivePackage
    expect(hasThumbnail(pkg(['video.mp4', 'thumbnail.png']))).toBe(true)
    expect(hasThumbnail(pkg(['video.mp4', 'thumbnail-2.png']))).toBe(false)
    expect(hasThumbnail(pkg([]))).toBe(false)
    expect(hasThumbnail(null)).toBe(false)
  })

  it('the description carries the chapters (m:ss) and the tags', () => {
    const pkg = {
      kind: 'package',
      nodeId: 'package',
      title: 'Le manuscrit de Voynich',
      alternatives: [],
      description: 'Un livre que personne ne sait lire.',
      chapters: [
        { at: 0, title: 'Introduction' },
        { at: 75.4, title: 'Le papier' }
      ],
      tags: ['voynich', 'mystère médiéval'],
      files: [],
      folder: 'C:/out/pkg',
      demo: true
    } satisfies LivePackage
    expect(packageDescription(pkg)).toBe('Un livre que personne ne sait lire.\n\n0:00 Introduction\n1:15 Le papier\n\n#voynich #mystèremédiéval')
  })
})
