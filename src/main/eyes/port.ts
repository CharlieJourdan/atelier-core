// What the eyes service needs from the outside: the Cloud's `channelData` and `analyseVideo` usages. The app's implementation
// goes through Atelier Cloud (src/main/cloud/intel.ts); tests inject a fake. Nothing here talks to YouTube or to a model.
import type { ChannelDataResult } from '../../shared/cloud-api'
import type { WholeVideoLog } from '../../shared/shot-log'
import type { AnalysisResult } from '../../shared/video-analysis'

export interface ChannelIntelPort {
  /** Atelier Cloud is connected (a read or an analysis needs it). */
  connected(): boolean
  /** The public numbers of a channel and its newest videos (YouTube Data API, read-only). `label` names the row in the ledger. */
  channelData(url: string, maxVideos: number, signal: AbortSignal, label: string): Promise<{ data: ChannelDataResult; demo: boolean }>
  /** The eyes' reading of one public video, billed in credits by the Cloud; only the first `minutes` are watched. */
  analyseVideo(url: string, minutes: number, signal: AbortSignal, label: string): Promise<{ analysis: AnalysisResult; demo: boolean }>
  /** « Watch a whole video » (src/main/eyes/whole.ts): the shot log of the WHOLE video, cached; absent (demonstration eyes) or null
   *  when it cannot be read whole — the caller then says plainly that its analysis covers only the watched minutes. */
  watchWhole?(url: string, o: { title?: string; durationS?: number | null }, signal: AbortSignal): Promise<{ log: WholeVideoLog; line: string } | null>
}
