// The voice of a run for the editor: one fetch over IPC gives both a blob URL (playback) and the waveform peaks
// (decoded in the renderer). If the browser cannot decode the file the peaks come from the words' timings instead.
import { useEffect, useState } from 'react'
import { call, errText } from '@/state/client'

export const PEAKS = 240

export interface Voice {
  url: string | null
  /** 0..1 per bucket, PEAKS buckets across the audio. */
  peaks: number[] | null
  /** True when the peaks were measured from the audio (false: drawn from the words' timings). */
  measured: boolean
  error: string | null
}

async function decodePeaks(bytes: Uint8Array): Promise<number[]> {
  const Ctx = window.AudioContext
  const ctx = new Ctx()
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const audio = await ctx.decodeAudioData(copy)
    const ch = audio.getChannelData(0)
    const size = Math.max(1, Math.floor(ch.length / PEAKS))
    const raw: number[] = []
    for (let i = 0; i < PEAKS; i++) {
      let max = 0
      const from = i * size
      const stride = Math.max(1, Math.floor(size / 64))
      for (let j = from; j < Math.min(ch.length, from + size); j += stride) max = Math.max(max, Math.abs(ch[j] ?? 0))
      raw.push(max)
    }
    const top = Math.max(...raw, 1e-6)
    return raw.map((v) => v / top)
  } finally {
    void ctx.close()
  }
}

/** Peaks from the words' timings: the share of each bucket covered by speech. */
export function peaksFromWords(words: { start: number; end: number }[], durationS: number): number[] {
  const out = new Array<number>(PEAKS).fill(0.08)
  if (durationS <= 0) return out
  for (const w of words) {
    const a = Math.floor((w.start / durationS) * PEAKS)
    const b = Math.ceil((w.end / durationS) * PEAKS)
    for (let i = Math.max(0, a); i < Math.min(PEAKS, b); i++) out[i] = 0.35 + 0.5 * ((i * 7919) % 13) / 13
  }
  return out
}

const EMPTY: Voice = { url: null, peaks: null, measured: false, error: null }

async function measure(bytes: Uint8Array, words: { start: number; end: number }[], durationS: number): Promise<{ peaks: number[]; measured: boolean }> {
  try {
    return { peaks: await decodePeaks(bytes), measured: true }
  } catch {
    return { peaks: peaksFromWords(words, durationS), measured: false }
  }
}

export function useVoice(runId: number | null, ref: string | null, words: { start: number; end: number }[], durationS: number): Voice {
  const key = runId !== null && ref !== null ? `${runId}:${ref}` : null
  const [res, setRes] = useState<{ key: string; voice: Voice } | null>(null)
  const wordKey = words.length
  useEffect(() => {
    if (runId === null || ref === null) return
    const mine = `${runId}:${ref}`
    let live = true
    let made: string | null = null
    call('production.file', runId, ref).then(
      async (f) => {
        if (!live) return
        made = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
        const m = await measure(f.bytes, words, durationS)
        if (live) setRes({ key: mine, voice: { url: made, peaks: m.peaks, measured: m.measured, error: null } })
      },
      (err: unknown) => {
        if (live) setRes({ key: mine, voice: { ...EMPTY, error: errText(err) } })
      }
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, ref, wordKey, durationS])
  return key !== null && res?.key === key ? res.voice : EMPTY
}
