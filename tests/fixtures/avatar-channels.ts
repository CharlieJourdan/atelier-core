// The 18 reference channels of research note avatar-channels-2026-10 (old repository) (§2, measured on 2026-10-31: two recent long videos
// each, transcripts and frames) as the eyes' measures: one `VideoMeasure` per video, the low end of each range for the first
// video, the high end for the second. Channels 1–3 have no frames (words per minute and the product mention only). Shares
// of the pictures are of the pictures alone (the presenter's time taken out). « Hook » becomes the curve: a presenter far
// more present in the opening than over the video is `hook-heavy`. Used as the style agent's test set (production-15).
import type { VideoMeasure } from '../../src/engine/technologies/fit'

export interface ReferenceChannel {
  n: number
  name: string
  lang: string
  videos: [VideoMeasure, VideoMeasure]
}

const photo = { lookFamily: 'photoreal', look: 'phone-real' } as const
const stock = { lookFamily: 'stock', look: 'clean-stock' } as const

export const REFERENCE_CHANNELS: readonly ReferenceChannel[] = [
  { n: 1, name: 'Le Garage de Gilbert', lang: 'fr', videos: [{ minutes: 11.5, wordsPerMinute: 211, sponsor: true, sponsorAtS: 380, sponsorS: 18 }, { minutes: 11.5, wordsPerMinute: 210, sponsor: true, sponsorAtS: 380, sponsorS: 20 }] },
  { n: 2, name: 'The Japanese Method', lang: 'en', videos: [{ minutes: 26, wordsPerMinute: 182, sponsor: true, sponsorAtS: 310, sponsorS: 20 }, { minutes: 27, wordsPerMinute: 185, sponsor: true, sponsorAtS: 450, sponsorS: 26 }] },
  { n: 3, name: 'Frugal Japan', lang: 'en', videos: [{ minutes: 27, wordsPerMinute: 182, sponsor: true, sponsorAtS: 340, sponsorS: 19 }, { minutes: 28, wordsPerMinute: 183, sponsor: true, sponsorAtS: 384, sponsorS: 28 }] },
  {
    n: 4,
    name: 'The Japanese Kitchen',
    lang: 'en',
    videos: [
      { minutes: 25, presenterShare: 0.25, layouts: ['full'], kinds: { imageAi: 1 }, shotS: 2.7, wordsPerMinute: 184, captions: false, labelsPerMinute: 0, sponsor: true, sponsorAtS: 401, sponsorS: 21, curve: 'flat', ...photo },
      { minutes: 26, presenterShare: 0.29, layouts: ['full'], kinds: { imageAi: 1 }, shotS: 3, wordsPerMinute: 188, captions: false, labelsPerMinute: 0, sponsor: true, sponsorAtS: 451, sponsorS: 30, curve: 'hook-heavy', ...photo }
    ]
  },
  {
    n: 5,
    name: 'L’Atelier de Didier',
    lang: 'fr',
    videos: [
      { minutes: 13, presenterShare: 0.04, layouts: ['inset', 'full'], kinds: { clipAi: 0.96, motion: 0.04 }, shotS: 2.7, wordsPerMinute: 184, captions: false, labelsPerMinute: 0, sponsor: true, sponsorAtS: 398, sponsorS: 20, curve: 'hook-heavy', ...photo },
      { minutes: 13.2, presenterShare: 0.08, layouts: ['inset', 'full'], kinds: { clipAi: 0.95, motion: 0.05 }, shotS: 3.3, wordsPerMinute: 189, captions: false, labelsPerMinute: 0, sponsor: false, curve: 'hook-heavy', ...photo }
    ]
  },
  {
    n: 6,
    name: 'Steve Copper Dogs',
    lang: 'en',
    videos: [
      { minutes: 15, presenterShare: 0.25, layouts: ['full'], kinds: { clipAi: 0.77, motion: 0.23 }, shotS: 3.8, wordsPerMinute: 198, captions: false, labelsPerMinute: 1, sponsor: true, sponsorAtS: 87, sponsorS: 25, curve: 'flat', ...photo },
      { minutes: 15.2, presenterShare: 0.38, layouts: ['full'], kinds: { clipAi: 0.9, motion: 0.1 }, shotS: 4.3, wordsPerMinute: 200, captions: false, labelsPerMinute: 1, sponsor: true, sponsorAtS: 140, sponsorS: 28, curve: 'flat', ...photo }
    ]
  },
  {
    n: 7,
    name: 'Raymond Astuces',
    lang: 'fr',
    videos: [
      { minutes: 18, presenterShare: 0, layouts: [], kinds: { stock: 1 }, shotS: 7, wordsPerMinute: 174, captions: false, labelsPerMinute: 2, sponsor: false, ...stock },
      { minutes: 19.4, presenterShare: 0.13, layouts: ['full'], kinds: { stock: 0.95, imageAi: 0.05 }, shotS: 7.5, wordsPerMinute: 181, captions: false, labelsPerMinute: 2, sponsor: false, curve: 'hook-heavy', ...stock }
    ]
  },
  {
    n: 8,
    name: 'Truques Gaúchos',
    lang: 'pt',
    videos: [
      { minutes: 17.5, presenterShare: 0.04, layouts: ['full'], kinds: { imageAi: 0.5, clipAi: 0.4, stock: 0.1 }, shotS: 2.7, wordsPerMinute: 142, captions: false, labelsPerMinute: 2, sponsor: false, curve: 'hook-heavy', ...photo },
      { minutes: 18, presenterShare: 0.08, layouts: ['full'], kinds: { imageAi: 0.45, clipAi: 0.45, stock: 0.1 }, shotS: 4.3, wordsPerMinute: 146, captions: false, labelsPerMinute: 2, sponsor: false, curve: 'hook-heavy', ...photo }
    ]
  },
  {
    n: 9,
    name: 'Ray Dutton’s Garage',
    lang: 'en',
    videos: [
      { minutes: 12, presenterShare: 0.21, layouts: ['full', 'split'], kinds: { imageAi: 0.95, clipAi: 0.05 }, shotS: 3.8, wordsPerMinute: 157, captions: false, labelsPerMinute: 0, sponsor: true, sponsorAtS: 125, sponsorS: 14, curve: 'hook-heavy', ...photo },
      { minutes: 12, presenterShare: 0.25, layouts: ['full', 'split'], kinds: { imageAi: 0.8, clipAi: 0.2 }, shotS: 5, wordsPerMinute: 170, captions: false, labelsPerMinute: 0, sponsor: true, sponsorAtS: 125, sponsorS: 15, curve: 'hook-heavy', ...photo }
    ]
  },
  {
    n: 10,
    name: 'Aunt Ann',
    lang: 'th',
    videos: [
      { minutes: 17, presenterShare: 0, layouts: [], kinds: { clipAi: 0.8, imageAi: 0.2 }, shotS: 3.8, captions: false, labelsPerMinute: 0, sponsor: false, ...photo },
      { minutes: 17, presenterShare: 0.17, layouts: ['full', 'split'], kinds: { clipAi: 0.9, imageAi: 0.1 }, shotS: 3.8, captions: false, labelsPerMinute: 0, sponsor: false, curve: 'flat', ...photo }
    ]
  },
  {
    n: 11,
    name: 'Hildegards Haushalt',
    lang: 'de',
    videos: [
      { minutes: 20, presenterShare: 0.21, layouts: ['full'], kinds: { imageAi: 0.58, clipAi: 0.27, motion: 0.15 }, shotS: 3.3, wordsPerMinute: 154, captions: false, labelsPerMinute: 2, sponsor: true, sponsorAtS: 83, sponsorS: 12, curve: 'flat', ...photo },
      { minutes: 21, presenterShare: 0.25, layouts: ['full', 'split'], kinds: { imageAi: 0.6, clipAi: 0.3, motion: 0.1 }, shotS: 3.3, wordsPerMinute: 154, captions: false, labelsPerMinute: 2, sponsor: true, sponsorAtS: 106, sponsorS: 12, curve: 'flat', ...photo }
    ]
  },
  {
    n: 12,
    name: 'Hinter der Theke',
    lang: 'de',
    videos: [
      { minutes: 12.5, presenterShare: 0.5, layouts: ['full', 'split', 'inset'], kinds: { imageAi: 0.6, motion: 0.4 }, shotS: 3.75, wordsPerMinute: 180, captions: false, labelsPerMinute: 2, sponsor: true, sponsorAtS: 345, sponsorS: 33, curve: 'flat', ...photo },
      { minutes: 13, presenterShare: 0.5, layouts: ['full', 'split', 'inset'], kinds: { imageAi: 0.45, motion: 0.55 }, shotS: 3.75, wordsPerMinute: 185, captions: false, labelsPerMinute: 2, sponsor: true, sponsorAtS: 429, sponsorS: 48, curve: 'flat', ...photo }
    ]
  },
  {
    n: 13,
    name: 'Kucharka z PRL',
    lang: 'pl',
    videos: [
      { minutes: 21, presenterShare: 0, layouts: [], kinds: { stock: 0.9, archive: 0.1 }, shotS: 3.8, wordsPerMinute: 124, captions: false, labelsPerMinute: 0, sponsor: true, sponsorAtS: 435, sponsorS: 12, ...stock },
      { minutes: 21.5, presenterShare: 0, layouts: [], kinds: { stock: 0.92, archive: 0.08 }, shotS: 3.8, wordsPerMinute: 132, captions: false, labelsPerMinute: 0, sponsor: true, sponsorAtS: 435, sponsorS: 16, ...stock }
    ]
  },
  {
    n: 14,
    name: 'La Cucina di Carmela',
    lang: 'it',
    videos: [
      { minutes: 13.5, presenterShare: 0.17, layouts: ['full', 'split'], kinds: { imageAi: 0.65, stock: 0.35 }, shotS: 5, wordsPerMinute: 142, captions: false, labelsPerMinute: 1.5, sponsor: true, sponsorAtS: 105, sponsorS: 24, curve: 'flat', ...photo },
      { minutes: 14, presenterShare: 0.25, layouts: ['full', 'split'], kinds: { imageAi: 0.7, stock: 0.3 }, shotS: 6, wordsPerMinute: 144, captions: false, labelsPerMinute: 1.5, sponsor: true, sponsorAtS: 105, sponsorS: 31, curve: 'flat', ...photo }
    ]
  },
  {
    n: 15,
    name: 'A Casa Limpa de Emiko',
    lang: 'pt',
    videos: [
      { minutes: 14, presenterShare: 0.08, layouts: ['full'], kinds: { imageAi: 0.6, motion: 0.4 }, shotS: 7.5, wordsPerMinute: 144, captions: false, labelsPerMinute: 1, sponsor: true, sponsorAtS: 73, sponsorS: 22, curve: 'hook-heavy', ...photo },
      { minutes: 14.2, presenterShare: 0.08, layouts: ['full'], kinds: { imageAi: 0.65, motion: 0.35 }, shotS: 7.5, wordsPerMinute: 147, captions: false, labelsPerMinute: 1, sponsor: true, sponsorAtS: 73, sponsorS: 27, curve: 'hook-heavy', ...photo }
    ]
  },
  {
    n: 16,
    name: 'Jo Danner',
    lang: 'en',
    videos: [
      { minutes: 22, presenterShare: 0.25, layouts: ['full'], kinds: { stock: 0.55, imageAi: 0.36, motion: 0.09 }, shotS: 2.7, wordsPerMinute: 156, captions: false, labelsPerMinute: 1, sponsor: true, sponsorAtS: 105, sponsorS: 20, curve: 'flat', ...photo },
      { minutes: 24, presenterShare: 0.33, layouts: ['full'], kinds: { stock: 0.6, imageAi: 0.3, motion: 0.1 }, shotS: 3.8, wordsPerMinute: 165, captions: false, labelsPerMinute: 1, sponsor: true, sponsorAtS: 105, sponsorS: 22, curve: 'flat', ...photo }
    ]
  },
  {
    n: 17,
    name: 'Babcia Ci Powie',
    lang: 'pl',
    videos: [
      { minutes: 20.6, presenterShare: 0.17, layouts: ['full'], kinds: { imageAi: 0.7, clipAi: 0.3 }, shotS: 5, wordsPerMinute: 136, captions: true, labelsPerMinute: 0, sponsor: false, ...photo },
      { minutes: 20.6, presenterShare: 0.17, layouts: ['full'], kinds: { imageAi: 0.7, clipAi: 0.3 }, shotS: 5, wordsPerMinute: 136, captions: true, labelsPerMinute: 0, sponsor: false, ...photo }
    ]
  },
  {
    n: 18,
    name: 'Czysty dom Emiko',
    lang: 'pl',
    videos: [
      { minutes: 14, presenterShare: 0.04, layouts: ['full'], kinds: { imageAi: 0.7, motion: 0.3 }, wordsPerMinute: 132, captions: false, labelsPerMinute: 1.5, sponsor: true, sponsorAtS: 70, sponsorS: 35, curve: 'hook-heavy', ...photo },
      { minutes: 14.2, presenterShare: 0.13, layouts: ['full'], kinds: { imageAi: 0.65, motion: 0.35 }, wordsPerMinute: 133, captions: false, labelsPerMinute: 1.5, sponsor: true, sponsorAtS: 70, sponsorS: 35, curve: 'hook-heavy', ...photo }
    ]
  }
]

export const channel = (n: number): ReferenceChannel => {
  const c = REFERENCE_CHANNELS.find((x) => x.n === n)
  if (!c) throw new Error(`no reference channel ${n}`)
  return c
}
