// What the main area shows for a route. Every area registers its screens in `screens/<area>/index.ts` (lot Z1);
// Réglages also hosts the component gallery. A route without a screen shows an empty state.
import { Gallery } from './Gallery'
import { t, type MessageKey } from '../../shared/fr'
import type { Route, SectionId } from '../../shared/sections'
import { EmptyState } from '@/components/atelier/primitives'
import { PageShell } from '@/components/atelier/page'
import { pageLabel } from '@/components/shell/ContextColumn'
import { AGENTS_SCREENS } from './agents'
import { CHANNELS_SCREENS } from './channels'
import { ANALYSIS_SCREENS } from './analysis'
import { BRAIN_SCREENS } from './brain'
import { COMPUTERS_SCREENS } from './computers'
import { HOME_SCREENS } from './home'
import { IDEAS_SCREENS } from './ideas'
import { MONEY_SCREENS } from './money'
import { PLANNING_SCREENS } from './planning'
import { PRODUCTION_SCREENS } from './production'
import { routeKey, type ScreenMap } from './registry'
import { SETTINGS_SCREENS } from './settings'
import { MessagesScreen } from './team/MessagesScreen'
import { TOOLS_SCREENS } from './tools'

export const SCREENS: ScreenMap = {
  ...HOME_SCREENS,
  ...CHANNELS_SCREENS,
  ...PLANNING_SCREENS,
  ...BRAIN_SCREENS,
  ...IDEAS_SCREENS,
  ...ANALYSIS_SCREENS,
  // Proto refresh: the new production screens replace the old pipeline / ressources routes, so they come after them.
  ...PRODUCTION_SCREENS,
  ...AGENTS_SCREENS,
  ...COMPUTERS_SCREENS,
  ...MONEY_SCREENS,
  ...TOOLS_SCREENS,
  ...SETTINGS_SCREENS
}

export function SectionPlaceholder({ section, page }: { section: SectionId; page?: string | undefined }) {
  if (page) {
    return (
      <PageShell section={section} title={pageLabel(section, page)} subtitle={t(`section.${section}`)}>
        <EmptyState title={t('empty.page.title')} blurb={t('empty.page.blurb')} />
      </PageShell>
    )
  }
  return (
    <PageShell section={section} title={t(`section.${section}`)}>
      <EmptyState title={t(`empty.${section}.title` as MessageKey)} blurb={t(`empty.${section}.blurb` as MessageKey)} />
    </PageShell>
  )
}

export function SectionScreen({ route, onRoute }: { route: Route; onRoute: (r: Route) => void }) {
  if (route.section === 'reglages' && route.page === 'galerie') return <Gallery />
  if (route.section === 'conversations') return <MessagesScreen route={route} onRoute={onRoute} />
  const Screen = SCREENS[routeKey(route)]
  if (Screen) return <Screen route={route} onRoute={onRoute} />
  return <SectionPlaceholder section={route.section} page={route.page} />
}
