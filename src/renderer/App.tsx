import { useCallback } from 'react'
import type { EventContract } from '../shared/api'
import { HOME_ROUTE, routeForView } from '../shared/sections'
import { ConfirmProvider } from './components/atelier/confirm'
import { Shell } from './components/shell/Shell'
import { TooltipProvider } from './components/ui/tooltip'
import { CloudFeaturesProvider } from './lib/cloud-features'
import { LocaleProvider } from './lib/locale'
import { IS_MAC } from './lib/platform'
import { RouterProvider, useRoute } from './lib/router'
import { ThemeProvider } from './lib/theme'
import { Toaster } from './lib/toast'
import { LiveSync } from './proto/live/LiveSync'
import { ProtoProvider, useProto } from './proto/store'
import { SectionScreen } from './screens/SectionScreen'
import { OnboardingFlow } from './screens/onboarding/OnboardingFlow'
import { mainScreenOf, useAccountGate, useFirstRun } from './screens/welcome/gate'
import { WelcomeScreen } from './screens/welcome/WelcomeScreen'
import { t } from '../shared/fr'
import { useEvent } from './state/client'

/** The main process asks to open a screen (notification clicks…). */
function NavigateEvents() {
  const { navigate } = useRoute()
  const onNavigate = useCallback(
    (p: EventContract['atelier:navigate']) => {
      navigate(routeForView(p.view))
    },
    [navigate]
  )
  useEvent('atelier:navigate', onNavigate)
  return null
}

/**
 * First the account (the beta's welcome, desktop app only), then the first-run onboarding while the workspace never
 * finished it (real mode), else the app; the onboarding replayed by hand shows over it too.
 */
function Main() {
  const { onboarded, mode } = useProto()
  const { navigate } = useRoute()
  const gate = useAccountGate()
  const firstRun = useFirstRun(gate === 'ready' && mode === 'live')
  const screen = mainScreenOf({ gate, mode, firstRunDone: firstRun.done, onboarded })
  if (screen === 'loading') return <div data-testid="app-loading" aria-label={t('beta.welcome.loading')} className="h-full bg-bg" />
  if (screen === 'welcome') return <WelcomeScreen />
  if (screen === 'onboarding') {
    const done = (): void => {
      // the first run is stored; a replay (or the presentation mode's) changes nothing in the database
      if (firstRun.done === false) firstRun.finish()
      navigate(HOME_ROUTE)
    }
    return <OnboardingFlow onDone={done} />
  }
  return (
    <>
      <NavigateEvents />
      <Shell mac={IS_MAC}>{(route, navigate) => <SectionScreen route={route} onRoute={navigate} />}</Shell>
    </>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <ProtoProvider>
          <LiveSync />
          <CloudFeaturesProvider>
            <TooltipProvider>
              <ConfirmProvider>
                <RouterProvider>
                  <Main />
                  <Toaster />
                </RouterProvider>
              </ConfirmProvider>
            </TooltipProvider>
          </CloudFeaturesProvider>
        </ProtoProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
