// The support videos of an idea (`idea.support`, pipeline-avatar §2.1) read by the eyes: the Cloud's `analyseVideo`, a
// quoted job billed in credits like every analysis (src/main/cloud/intel.ts). Only the analysis comes back (summary, hook,
// parts), never the transcript, so another channel's wording cannot reach the script.
import type { VideoReaderService, VideoReading } from '../../engine/services'
import type { AnalysisResult } from '../../shared/video-analysis'
import type { ChannelIntelPort } from '../eyes/port'

/** An analysis of the eyes as the reading `idea.support` keeps. */
export function readingOf(url: string, a: AnalysisResult, demo: boolean): VideoReading {
  const end = Math.max(a.hook.endsAtS, ...a.structure.map((s) => s.toS), 0)
  return {
    title: a.summary.split(/(?<=[.!?])\s/u)[0]?.slice(0, 120) || url,
    summary: a.summary,
    hook: a.hook,
    parts: a.structure.map((s) => ({ kind: s.kind, fromS: s.fromS, toS: s.toS, summary: s.summary })),
    durationS: end,
    demo
  }
}

export function supportReader(intel: () => ChannelIntelPort): VideoReaderService {
  return {
    async read(req, signal) {
      const { analysis, demo } = await intel().analyseVideo(req.url, req.minutes, signal, 'Vidéo d’appui')
      return readingOf(req.url, analysis, demo)
    }
  }
}
