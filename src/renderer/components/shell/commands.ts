// The commands offered by ⌘K. Pure data + closures, so the palette's content is unit-testable without a DOM.
import { t } from '../../../shared/fr'
import { SECTION_IDS, pagesOf, type Route, type SectionId } from '../../../shared/sections'
import { pageLabel } from './ContextColumn'

export interface Command {
  id: string
  group: 'navigation' | 'pages' | 'actions'
  label: string
  /** Extra words the search also matches. */
  keywords?: string[]
  /** Section whose icon is shown (navigation / pages). */
  section?: SectionId
  run: () => void
}

export function buildCommands(deps: {
  navigate: (to: SectionId | Route) => void
  toggleTheme: () => void
}): Command[] {
  const nav: Command[] = SECTION_IDS.map((id) => ({
    id: `go-${id}`,
    group: 'navigation',
    label: t(`section.${id}`),
    section: id,
    run: () => deps.navigate(id)
  }))
  const pages: Command[] = SECTION_IDS.flatMap((section) =>
    pagesOf(section).map((page) => ({
      id: `go-${section}-${page}`,
      group: 'pages' as const,
      label: `${t(`section.${section}`)} › ${pageLabel(section, page)}`,
      section,
      run: () => deps.navigate({ section, page })
    }))
  )
  const actions: Command[] = [
    { id: 'toggle-theme', group: 'actions', label: t('palette.action.theme'), keywords: ['thème', 'dark', 'light'], run: deps.toggleTheme },
    {
      id: 'open-gallery',
      group: 'actions',
      label: t('palette.action.gallery'),
      keywords: ['composants', 'design'],
      run: () => deps.navigate({ section: 'reglages', page: 'galerie' })
    }
  ]
  return [...nav, ...actions, ...pages]
}
