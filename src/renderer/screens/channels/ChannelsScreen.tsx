// Chaînes (route `chaines`): the channels of the workspace, each with its figures, cadence and who does what; the detail of
// a channel; the flow that adds a new one (the onboarding, minus the agent and engine steps); and a way to see the
// first-run welcome again. Follows the global channel scope.
import { Plus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../../shared/fr'
import { GOOGLE_SETTINGS_ROUTE, GoogleCta } from '@/components/proto/GoogleCta'
import { ProtoPage } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { useProto, useProtoActions } from '@/proto/store'
import type { ScreenProps } from '../registry'
import { OnboardingFlow } from '../onboarding/OnboardingFlow'
import { clearAddChannelRequest, hasAddChannelRequest, onAddChannelRequest } from './add-intent'
import { ChannelCard } from './ChannelCard'
import { ArchivedChannels } from './ChannelLife'
import { ChannelDetail, isDetailTab, type DetailTab } from './ChannelDetail'

export function ChannelsScreen({ onRoute, initialChannelId, initialTab }: ScreenProps & { initialChannelId?: string; initialTab?: string }) {
  const state = useProto()
  const { setOnboarded } = useProtoActions()
  const [openId, setOpenId] = useState<string | null>(initialChannelId ?? null)
  const [tab, setTab] = useState<DetailTab>(isDetailTab(initialTab) ? initialTab : 'automation')
  // « Ajouter une chaîne » from Accueil or the sidebar lands here with the flow already open
  const [adding, setAdding] = useState(hasAddChannelRequest)
  useEffect(() => {
    clearAddChannelRequest()
    return onAddChannelRequest(() => {
      clearAddChannelRequest()
      setOpenId(null)
      setAdding(true)
    })
  }, [])

  const visible = state.scope === 'all' ? state.channels : state.channels.filter((c) => c.id === state.scope)
  const open = openId ? state.channels.find((c) => c.id === openId) : undefined
  const connected = visible.filter((c) => c.connected).length
  // Real mode: the figures come from the owner's Google account (Réglages › Chaînes › Google)
  const live = state.mode === 'live'

  const overlay = adding ? (
    <div data-testid="add-channel-overlay" className="fixed inset-0 z-50 bg-bg">
      <OnboardingFlow mode="add-channel" onClose={() => setAdding(false)} onDone={() => setAdding(false)} />
    </div>
  ) : null

  if (open) {
    return (
      <section data-testid="view-chaines" className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1180px] px-8 pt-5 pb-12">
            <ChannelDetail
              channel={open}
              tab={tab}
              onTab={setTab}
              onBack={() => {
                setOpenId(null)
                setTab('automation')
              }}
              onRoute={onRoute}
            />
          </div>
        </div>
        {overlay}
      </section>
    )
  }

  return (
    <ProtoPage
      testId="view-chaines"
      title={t('section.chaines')}
      subtitle={<span data-testid="chaines-summary">{t('chan.summary', { n: visible.length, connected })}</span>}
      actions={
        <>
          <Button variant="ghost" data-testid="replay-onboarding" onClick={() => setOnboarded(false)}>
            <RotateCcw aria-hidden />
            {t('chan.replay')}
          </Button>
          <Button data-testid="add-channel" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('chan.add')}
          </Button>
        </>
      }
    >
      {visible.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center" data-testid="chaines-empty">
          <p className="text-[15px] font-medium text-fg">{t('chan.empty.title')}</p>
          <p className="max-w-[420px] text-[13px] text-fg-3">{t('chan.empty.hint')}</p>
          <Button className="mt-2" data-testid="chaines-empty-add" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('chan.add')}
          </Button>
        </div>
      ) : (
        <>
          {live && connected === 0 && <GoogleCta onRoute={onRoute} className="mb-4" />}
          <div className="grid gap-4 @container md:grid-cols-2" data-testid="chaines-grid">
            {visible.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                source={c.translatedFrom ? state.channels.find((x) => x.id === c.translatedFrom) : undefined}
                pipelines={state.pipelines}
                onOpen={(next) => {
                  if (live && next === 'connections' && !c.connected) return onRoute(GOOGLE_SETTINGS_ROUTE)
                  setOpenId(c.id)
                  setTab(isDetailTab(next) ? next : 'automation')
                }}
              />
            ))}
          </div>
        </>
      )}
      <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-fg-3" data-testid="chaines-legend">
        <span>{t('chan.legend.title')}</span>
        <span>
          <b className="font-semibold text-fg-2">A</b> {t('automation.auto').toLowerCase()}
        </span>
        <span>
          <b className="font-semibold text-fg-2">V</b> {t('automation.validate').toLowerCase()}
        </span>
        <span>
          <b className="font-semibold text-fg-2">M</b> {t('automation.human').toLowerCase()}
        </span>
      </p>
      {state.mode === 'live' && <ArchivedChannels />}
      {overlay}
    </ProtoPage>
  )
}
