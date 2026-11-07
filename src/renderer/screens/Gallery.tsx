// Galerie (dev): every component of the design system on one page, in the current theme. Reached from
// Réglages › Galerie (dev) and from ⌘K.
import { ChatGallery } from './ChatGallery'
import { useMemo, useState, type ReactNode } from 'react'
import { t } from '../../shared/fr'
import { AGENT_COLORS, AgentDot, EmptyState, Panel, StatTile, StateChip, StatusDot } from '@/components/atelier/primitives'
import { ConfirmBody, useConfirm } from '@/components/atelier/confirm'
import { DemoBanner, DemoBadge } from '@/components/atelier/demo'
import { MascotGallery } from '@/components/mascot/MascotGallery'
import { PageShell } from '@/components/atelier/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { demoWaveform, makeToneUrl } from '@/lib/demo-audio'
import { toast } from '@/lib/toast'
import {
  AudioPlayerButton,
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerProvider,
  AudioPlayerTime,
  LazyOrb,
  ShimmeringText,
  Waveform
} from '../vendor/elevenlabs-ui'

const TOKENS = [
  ['bg', 'bg-bg'],
  ['surface-1', 'bg-surface-1'],
  ['surface-2', 'bg-surface-2'],
  ['surface-pop', 'bg-surface-pop'],
  ['ink', 'bg-ink'],
  ['brand', 'bg-brand'],
  ['ok', 'bg-ok'],
  ['warn', 'bg-warn'],
  ['err', 'bg-err'],
  ['info', 'bg-info']
] as const

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10" data-testid={`gallery-${title}`}>
      <h2 className="micro-label mb-3">{title}</h2>
      {children}
    </section>
  )
}

function AudioDemo() {
  const src = useMemo(() => makeToneUrl(3), [])
  const bars = useMemo(() => demoWaveform(56), [])
  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('gallery.audio')} className="max-w-[560px]">
        <AudioPlayerProvider>
          <div className="flex items-center gap-3">
            <AudioPlayerButton item={{ id: 'demo-tone', src }} variant="default" size="icon" />
            <AudioPlayerTime className="text-xs text-fg-3" />
            <AudioPlayerProgress className="flex-1" />
            <AudioPlayerDuration className="text-xs text-fg-3" />
          </div>
        </AudioPlayerProvider>
      </Panel>
      <Panel title={t('gallery.waveform')} className="max-w-[560px]">
        <Waveform data={bars} height={56} barWidth={3} barGap={2} />
      </Panel>
    </div>
  )
}

function Feedback() {
  const confirm = useConfirm()
  const [last, setLast] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={() => toast.success(t('gallery.toastOk'))}>
        {t('gallery.toastOk')}
      </Button>
      <Button variant="secondary" onClick={() => toast.demo()}>
        {t('gallery.toastDemo')}
      </Button>
      <Button
        variant="outline"
        data-testid="gallery-confirm"
        onClick={async () => {
          const ok = await confirm({
            title: t('gallery.confirmTitle'),
            description: t('gallery.confirmBody'),
            confirmLabel: t('gallery.confirmAction'),
            danger: true
          })
          setLast(ok ? t('gallery.confirmed') : t('gallery.cancelled'))
        }}
      >
        {t('gallery.confirm')}
      </Button>
      {last && <span className="text-xs text-fg-3">{last}</span>}
    </div>
  )
}

export function Gallery() {
  return (
    <PageShell section="reglages" title={t('gallery.title')} subtitle={t('gallery.blurb')}>
      <Block title={t('gallery.tokens')}>
        <div className="flex flex-wrap gap-3">
          {TOKENS.map(([name, cls]) => (
            <div key={name} className="flex w-24 flex-col gap-1.5">
              <div className={`h-12 rounded-field border border-line-2 ${cls}`} />
              <span className="font-mono text-[10px] text-fg-3">{name}</span>
            </div>
          ))}
          <div className="flex w-48 flex-col gap-1.5">
            <div className="progress-fill h-12 rounded-field" />
            <span className="font-mono text-[10px] text-fg-3">progress</span>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-baseline gap-8">
          <p className="display-title">Atelier</p>
          <p className="page-title">Titre de page</p>
          <p className="text-[13px]">Inter 13 px, interligne 1,45.</p>
          <p className="micro-label">Étiquette mono</p>
        </div>
      </Block>

      <Block title={t('gallery.buttons')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Principal</Button>
          <Button variant="brand">Accent</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="outline">Contour</Button>
          <Button variant="ghost">Discret</Button>
          <Button variant="destructive">Danger</Button>
          <Button disabled>Désactivé</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">À valider</TabsTrigger>
              <TabsTrigger value="b">Activité</TabsTrigger>
            </TabsList>
          </Tabs>
          <Badge>Neutre</Badge>
          <Badge variant="brand">Accent</Badge>
          <Badge variant="ok">Ok</Badge>
          <Badge variant="warn">Attention</Badge>
          <Badge variant="err">Erreur</Badge>
        </div>
      </Block>

      <Block title={t('gallery.mascots')}>
        <MascotGallery />
      </Block>

      <Block title={t('gallery.atelier')}>
        <div className="grid max-w-[900px] grid-cols-3 gap-3">
          <StatTile label="Vidéos en cours" value="4" hint="2 attendent ta décision" />
          <StatTile label="Dépenses du mois" value="$12.40" hint="plafond 50 $" />
          <StatTile label="Durée moyenne" value="14 min" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <StateChip state="working" />
          <StateChip state="waiting" />
          <StateChip state="blocked" />
          <StateChip state="idle" />
          <StateChip state="done" />
          <span className="flex items-center gap-1.5 text-xs text-fg-3">
            <StatusDot tone="ok" /> ok <StatusDot tone="warn" /> warn <StatusDot tone="err" /> err <StatusDot tone="off" /> off
          </span>
          <DemoBadge />
          <span className="flex items-center gap-1">
            {AGENT_COLORS.map((_, i) => (
              <AgentDot key={i} index={i} size={24} />
            ))}
          </span>
        </div>
        <div className="mt-4 max-w-[640px]">
          <DemoBanner reason="Le contrôle souris n’est pas branché." unlockedBy="Pas prévu pour l’instant." />
        </div>
        <div className="grid max-w-[900px] grid-cols-2 gap-3">
          <Panel title="Panel">
            <Skeleton className="mb-2 h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </Panel>
          <Panel title="EmptyState">
            <EmptyState title={t('empty.generic')} className="py-6" />
          </Panel>
        </div>
      </Block>

      <Block title={t('gallery.feedback')}>
        <Feedback />
        <div className="mt-4 max-w-[480px] rounded-modal border border-line-2 bg-surface-pop p-6">
          <ConfirmBody
            options={{ title: t('gallery.confirmTitle'), description: t('gallery.confirmBody'), confirmLabel: t('gallery.confirmAction'), danger: true }}
            onResolve={() => undefined}
            standalone
          />
        </div>
      </Block>

      <Block title={t('gallery.elevenlabs')}>
        <div className="mb-6 flex flex-wrap items-end gap-8">
          <figure className="flex flex-col items-center gap-2">
            <div className="size-24" data-testid="gallery-orb">
              <LazyOrb colors={['#B7A8FF', '#F5A3D0']} agentState="thinking" />
            </div>
            <figcaption className="micro-label">{t('gallery.orb')}</figcaption>
          </figure>
          <figure className="flex flex-col gap-2">
            <ShimmeringText text={t('gallery.shimmerText')} className="text-sm" />
            <figcaption className="micro-label">{t('gallery.shimmer')}</figcaption>
          </figure>
        </div>
        <AudioDemo />
      </Block>

      <Block title={t('gallery.chat')}>
        <ChatGallery />
      </Block>
    </PageShell>
  )
}
