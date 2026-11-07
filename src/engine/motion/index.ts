// The motion template library (docs/ENGINE-SPEC.md §25): a spec in, the HTML page of that template out. Pure: the same spec, size and
// duration always give the same page, and the page gives the same picture at the same time (runtime.ts). Everything here is ours.
import type { CardAssets } from '../formats/cards'
import { MotionSpec, type MotionSpecInput } from '../formats/motion'
import { pageHtml, themeOf, type MotionCtx } from './base'
import { figure, lowerThird, quote, titleCard, type Part } from './cards'
import { conversation } from './conversation'
import { chartCard } from './doc-chart'
import { archiveCard, barsCard, printsCard, timelineCard } from './doc-cards'
import { documentCard } from './doc-highlight'
import { docTags } from './doc-tags'
import { docStyleOf, parchmentStyleOf } from './doc-parchment'
import { kinetic } from './kinetic'
import { resolveLook, type MotionLook, type PaperLook } from './look'
import { mapCard } from './map-card'
import { map3dCard } from './map3d'
import { povCard } from './pov-cards'
import { studioCard } from './studio'
import { list, mapPin } from './scenes'

export { MOTION_VERSION, type MotionCtx } from './base'
export { LOOK_TEMPLATES, MotionLook, resolveLook, type PaperLook } from './look'

/**
 * The HTML page of a graphic. A spec that does not match its template throws (a template error is permanent and names its field). A
 * documentary card (formats/cards.ts) gets what `motion.render` prepared for it (its picture, its map), and draws its own opaque background.
 * `motionLook` (look.ts): the video's look; a paper look draws kinetic and chart on its paper and the documentary cards in their parchment,
 * whatever the spec's theme. None (or `modern`): every page exactly as without it.
 */
export function motionHtml(input: MotionSpecInput, c: MotionCtx, assets: CardAssets = {}, motionLook?: MotionLook | PaperLook | null): string {
  const spec = MotionSpec.parse(input)
  const paper = motionLook && typeof motionLook === 'object' && 'paperDeep' in motionLook ? motionLook : resolveLook(motionLook ?? undefined)
  // the documentary cards have two looks: the dark slate (theme 'dark', the default) and the parchment (theme 'light', doc-parchment.ts)
  const look = paper ? parchmentStyleOf(paper.accent) : docStyleOf(spec.theme, spec.accent)
  const theme = themeOf(spec.accent, spec.theme)
  const part = ((): Part => {
    switch (spec.template) {
      case 'title':
        return titleCard(spec.props, c)
      case 'lower-third':
        return lowerThird(spec.props, c)
      case 'figure':
        return figure(spec.props, c)
      case 'list':
        return list(spec.props, c)
      case 'quote':
        return quote(spec.props, c)
      case 'map-pin':
        return mapPin(spec.props, c)
      case 'conversation':
        return conversation(spec.props, c)
      case 'kinetic':
        return kinetic(spec.props, c, theme, spec.accent, paper)
      case 'doc-tags':
        return docTags(spec.props, c)
      case 'archive':
        return archiveCard(spec.props, c, assets, look)
      case 'map':
        return mapCard(spec.props, c, assets, look)
      case 'bars':
        return barsCard(spec.props, c, look)
      case 'timeline':
        return timelineCard(spec.props, c, look)
      case 'prints':
        return printsCard(spec.props, c, assets)
      case 'document':
        return documentCard(spec.props, c, assets, look)
      case 'chart':
        return chartCard(spec.props, c, look, paper)
      case 'map3d':
        return map3dCard(spec.props, c, assets.map3d, spec.accent)
      case 'pov':
        return povCard(spec.props, c)
      case 'studio':
        return studioCard(spec.props, c, assets.studio)
    }
  })()
  return pageHtml(c, theme, spec.accent, part.css, part.body)
}
