// Real mode, Planning › publication kit: the real upload package of the video's run (title, description, the folder
// with the video, the captions and the metadata), read once the `package` node is done. Atelier never uploads: the
// kit opens the folder and copies the texts, the user publishes by hand.
import { useEffect, useState } from 'react'
import type { RunOutput } from '../../../shared/runs'
import { isDesktop } from '@/proto/live/driver'
import type { ProtoVideo } from '@/proto/types'
import { call } from '@/state/client'

export type LivePackage = Extract<RunOutput, { kind: 'package' }>

/** The run that holds the video's package, when the package node is done (null otherwise or outside the desktop app). */
export function packageRunOf(video: ProtoVideo | undefined): number | null {
  const run = video?.liveRun
  if (!run) return null
  const node = run.nodes.find((n) => n.nodeId === 'package')
  return node && (node.state === 'done' || node.state === 'cached') ? run.runId : null
}

export function useLivePackage(video: ProtoVideo | undefined): LivePackage | null {
  const runId = packageRunOf(video)
  const [pkg, setPkg] = useState<{ runId: number; value: LivePackage } | null>(null)
  useEffect(() => {
    if (runId === null || !isDesktop()) return
    let stop = false
    call('production.output', runId, 'package')
      .then((out) => {
        if (!stop && out.kind === 'package') setPkg({ runId, value: out })
      })
      .catch(() => undefined)
    return () => {
      stop = true
    }
  }, [runId])
  return pkg && pkg.runId === runId ? pkg.value : null
}

/** The package folder holds the thumbnail (`thumbnail.png`, written by the package node when the pipeline has a thumbnail step). */
export const hasThumbnail = (pkg: LivePackage | null): boolean => pkg !== null && pkg.files.some((f) => f.name === 'thumbnail.png')

/** The description as it goes on YouTube: the text, then the chapters (m:ss) and the tags. */
export function packageDescription(pkg: LivePackage): string {
  const at = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const chapters = pkg.chapters.map((c) => `${at(c.at)} ${c.title}`).join('\n')
  const tags = pkg.tags.map((x) => `#${x.replace(/\s+/g, '')}`).join(' ')
  return [pkg.description, chapters, tags].filter((x) => x.trim().length > 0).join('\n\n')
}
