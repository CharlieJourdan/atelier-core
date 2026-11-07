// The Lab, Production's home (production-lab, Charlie's notes of 2026-11-01; it replaces the start screen « Démarrer »):
// on top the actions, « Créer une pipeline » the big one and « Nouvelle vidéo » beside it (it left the app's top bar); on
// the side « Mes pipelines », each a small card with its progress graph, its videos in production, the average price of a
// video (credits, with its render time) and its channels; in the middle « Pipelines prêtes » (the base pipelines' new
// name), a little more visible, with its categories, its order and « Voir toutes les pipelines ». No Atlas here (he sits
// beside the Pipeline and Projets pages); no beta tools; no provider. Developers keep « Construire à la main » and the file
// import under « Avancé » (decision 0051 and pipeline codes' flag).
import { ArrowRight, Plus, Sparkles } from 'lucide-react'
import { useRef } from 'react'
import { t } from '../../../../shared/fr'
import { SubscriptionLock } from '@/components/orchestra/SubscriptionLock'
import { ProtoPage, SectionHead } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { useProto } from '@/proto/store'
import { call, errText } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { usePipelineCodes, usePipelineDev } from '../recettes/dev-flag'
import { openRecipeNext } from '../recettes/selection'
import { LoadLine } from '../recettes/ui'
import { orderMine } from './lab-model'
import { MyPipelineCard } from './MyPipelines'
import { ReadyBrowser } from './ReadyBrowser'
import { useLab } from './use-lab'

export function LabScreen({ onRoute }: ScreenProps) {
  const state = useProto()
  const dev = usePipelineDev()
  const codes = usePipelineCodes()
  const lab = useLab(onRoute)
  const file = useRef<HTMLInputElement>(null)
  const importFile = async (f: File | undefined): Promise<void> => {
    if (!f) return
    try {
      const d = await call('recipes.import', await f.text())
      toast.success(t('prodStart.import.done'))
      lab.open(d.id)
    } catch (e) {
      toast.error(errText(e))
    } finally {
      if (file.current) file.current.value = ''
    }
  }
  const mine = orderMine(lab.recipes ?? [], lab.activity)
  const bases = lab.bases ?? []
  return (
    <ProtoPage testId="view-production-start" wide title={t('lab.title')} subtitle={t('lab.subtitle')}>
      {state.mode === 'live' && <SubscriptionLock body="llmAccess.locked.script" className="mb-6" />}
      <div className="mb-9 flex flex-wrap items-center gap-3" data-testid="lab-actions">
        <button
          type="button"
          data-testid="create-pipeline"
          onClick={() => onRoute({ section: 'production', page: 'creer' })}
          className="group relative flex h-14 items-center gap-3 overflow-hidden rounded-full bg-brand pr-6 pl-2 text-brand-ink shadow-[0_8px_28px_-10px_var(--brand),var(--shadow-1)] outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_12px_32px_-10px_var(--brand),var(--shadow-1)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-brand-ink/10">
            <Sparkles className="size-[18px]" />
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[15.5px] font-semibold tracking-[-0.012em]">{t('lab.create')}</span>
            <span className="text-[11.5px] font-medium opacity-70">{t('lab.create.hint')}</span>
          </span>
        </button>
        <Button variant="secondary" size="lg" className="h-14 px-5 text-[14px]" onClick={() => lab.newVideo(null)} data-testid="new-video">
          <Plus className="size-4" />
          {t('lab.newVideo')}
        </Button>
      </div>

      <LoadLine error={lab.error} loading={false} />
      <div className="grid grid-cols-1 gap-9 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="order-2 min-w-0 lg:order-1" data-testid="team-recipes">
          <SectionHead title={t('lab.mine')} count={mine.length} />
          {lab.recipes && mine.length === 0 && (
            <p className="rounded-[var(--r-card)] border border-dashed border-line-2 px-4 py-5 text-[12.5px] leading-[1.5] text-fg-3">{t('lab.mine.empty')}</p>
          )}
          <div className="flex gap-3 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0 [&>*]:w-[280px] [&>*]:shrink-0 lg:[&>*]:w-full">
            {mine.map((r) => (
              <MyPipelineCard key={r.id} recipe={r} activity={lab.activity.get(r.id)} estimates={lab.estimates} onOpen={(id) => lab.open(id)} />
            ))}
          </div>
        </aside>

        <section className="order-1 min-w-0 lg:order-2" data-testid="prebuilt-recipes">
          <SectionHead
            title={t('lab.ready')}
            count={bases.length}
            action={
              <Button variant="link" size="sm" className="px-0" onClick={() => onRoute({ section: 'production', page: 'pretes' })} data-testid="ready-all">
                {t('lab.ready.all')}
                <ArrowRight className="size-3.5" />
              </Button>
            }
          />
          {lab.bases && bases.length === 0 && <p className="text-[12.5px] leading-[1.5] text-fg-3">{t('lab.ready.empty')}</p>}
          {bases.length > 0 && <ReadyBrowser bases={bases} estimates={lab.estimates} layout="row" actions={{ busy: lab.busy, onUse: (b) => void lab.use(b), onAdd: (b, m) => void lab.add(b, m) }} />}
        </section>
      </div>

      {(dev || codes) && (
        <details className="mt-10 text-[12.5px]" data-testid="start-advanced">
          <summary className="cursor-pointer text-fg-3">{t('lab.dev')}</summary>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {dev && (
              <Button
                size="sm"
                variant="secondary"
                data-testid="build-self"
                onClick={() => {
                  openRecipeNext(null)
                  onRoute({ section: 'production', page: 'pipeline' })
                }}
              >
                {t('prodStart.self.go')}
              </Button>
            )}
            {codes && (
              <>
                <input ref={file} type="file" accept=".json,application/json" className="hidden" data-testid="import-file" onChange={(e) => void importFile(e.target.files?.[0])} />
                <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
                  {t('lab.dev.import')}
                </Button>
              </>
            )}
          </div>
        </details>
      )}
    </ProtoPage>
  )
}
