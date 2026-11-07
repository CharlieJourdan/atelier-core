// Proof driver (decision 0099): a short real render of the channel-styled card family — for each acceptance channel, its card style
// computed from its Style Definition, five templates of 3 s each drawn by the browser (motion/styled-cards.ts) and joined into one
// film (≤ 60 s for four channels), plus each card's landed frame. Run by tests/unit/clone-pipeline-proof.test.ts; never by the app.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { StyleDefinition } from '../../../../shared/clone'
import { nodeHost } from '../../../../engine/host'
import { docFontCssOf } from '../../../../engine/motion/fonts'
import { CARD_ENCODER, renderGraphic } from '../../../../engine/motion/render'
import { MotionSpec } from '../../../../engine/formats/motion'
import { styledCardHtml } from '../../../../engine/motion/styled-cards'
import type { StyledTemplate } from '../../../../engine/motion/styled'
import { FPS } from '../../../../engine/formats/timing'
import { cardStyleFrom } from './values'

/** The sample cards (French words of a finance / home / daily-life film). */
const SAMPLES: { template: StyledTemplate; props: unknown }[] = [
  { template: 'title', props: { title: 'Ton épargne perd de la valeur', kicker: 'Chapitre 1' } },
  { template: 'figure', props: { value: 2.4, decimals: 1, suffix: '%', label: 'd’inflation en un an' } },
  { template: 'chart', props: { title: 'Le prix du pain', kind: 'line', unit: '€', atS: 0.4, drawS: 1.6, points: [{ label: '2015', value: 0.87 }, { label: '2018', value: 0.89 }, { label: '2021', value: 0.95 }, { label: '2024', value: 1.12 }] } },
  { template: 'list', props: { heading: 'Trois réflexes', items: [{ text: 'Comparer les frais' }, { text: 'Placer chaque mois' }, { text: 'Garder une réserve' }] } },
  { template: 'kinetic', props: { words: [{ text: 'Et', atS: 0.2 }, { text: 'pourtant', atS: 0.45 }, { text: 'personne', atS: 0.8, emphasis: true }, { text: 'n’en', atS: 1.15 }, { text: 'parle', atS: 1.4 }] } }
]

export async function renderStyledReel(o: { outDir: string; resourcesDir: string; channels: { name: string; def: StyleDefinition }[]; seconds?: number }): Promise<{ film: string; frames: string[]; styles: Record<string, unknown> }> {
  const host = nodeHost({ dataDir: path.join(o.outDir, 'host'), resourcesDir: o.resourcesDir })
  const browser = host.services.browser!
  const media = host.services.media!
  const fontCss = await docFontCssOf(path.join(o.resourcesDir))
  const seconds = o.seconds ?? 3
  const frames = Math.round(seconds * FPS)
  const parts: string[] = []
  const stills: string[] = []
  const styles: Record<string, unknown> = {}
  mkdirSync(o.outDir, { recursive: true })
  try {
    for (const ch of o.channels) {
      const style = cardStyleFrom(ch.def)
      styles[ch.name] = style ?? null
      if (!style) continue
      for (const s of SAMPLES) {
        const spec = MotionSpec.parse({ template: s.template, props: s.props })
        // the reel shows each card as the film would: a full-screen card on its ground, an overlay over a mid-grey picture stand-in
        const html = styledCardHtml(s.template, spec.props, { width: 1920, height: 1080, durationS: seconds, fontCss }, style).replace('html,body{margin:0;padding:0;', `html,body{margin:0;padding:0;background:${style.fullScreen ? style.ground : '#5a5f66'} !important;`)
        const out = path.join(o.outDir, `${ch.name}-${s.template}.mp4`)
        await renderGraphic({ browser, media, html, width: 1920, height: 1080, frames, out, signal: new AbortController().signal, encoder: CARD_ENCODER })
        parts.push(out)
        const still = path.join(o.outDir, `${ch.name}-${s.template}.jpg`)
        spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', (seconds * 0.7).toFixed(2), '-i', out, '-frames:v', '1', '-vf', 'scale=960:-2', still], { windowsHide: true })
        stills.push(still)
      }
    }
  } finally {
    await host.cleanup()
  }
  const list = path.join(o.outDir, 'reel.txt')
  writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n') + '\n')
  const film = path.join(o.outDir, 'styled-cards-reel.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', film], { windowsHide: true })
  return { film, frames: stills, styles }
}
