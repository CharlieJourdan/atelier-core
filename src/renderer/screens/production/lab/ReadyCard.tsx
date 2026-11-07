// A ready pipeline (« pipeline prête », the base pipelines' new name, production-lab). Charlie 01/11: « on met juste le nom
// de la pipeline, ensuite on mettra une vidéo d'exemple (1-2 min pour chaque) et surtout les spécificités comme le temps,
// le coût moyen… en dessous 3 boutons ». So: the name, an example slot (a drawn poster until real examples exist), the
// average render time, the average cost of a video in credits, Long / Short; then « Utiliser cette pipeline », « Ajouter à
// mes pipelines » (as is, or « Modifier » with the agent: recommended) and « Voir » (what it makes and what can be set).
import { AudioLines, Play, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { EstimateCardsView } from '../../../../shared/estimates'
import { optionPlace } from '../../../../shared/option-previews'
import type { BasePipelineInfo } from '../../../../shared/recipes'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { durationText, eurOf } from '../recettes/estimate-format'
import { categoryOf, creditsText, videoSpecs } from './lab-model'
import { FormTag } from './MyPipelines'

export const baseName = (b: Pick<BasePipelineInfo, 'labelKey'>): string => t(b.labelKey as MessageKey)

/** The example video's slot: a drawn poster of what the pipeline makes, until each pipeline has its 1–2 min example. */
export function ExamplePoster({ base, className }: { base: BasePipelineInfo; className?: string }) {
  const presenter = categoryOf(base) === 'avatar'
  const sky = `sky-${base.id.replace(/\W/g, '-')}`
  return (
    <div
      data-testid={`example-${base.id}`}
      className={cn('relative aspect-video w-full overflow-hidden rounded-[12px] border border-line bg-surface-2', className)}
      aria-label={t('lab.example')}
      role="img"
    >
      <svg viewBox="0 0 320 180" className="absolute inset-0 size-full" aria-hidden preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={sky} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="0.55" stopColor="var(--surface-2)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill={`url(#${sky})`} />
        {/* the pictures the video cuts to */}
        <rect x="18" y="22" width="112" height="64" rx="8" fill="var(--fg)" fillOpacity="0.07" />
        <rect x="18" y="94" width="76" height="44" rx="8" fill="var(--fg)" fillOpacity="0.05" />
        <rect x="102" y="94" width="76" height="44" rx="8" fill="var(--brand)" fillOpacity="0.12" />
        {presenter ? (
          // the presenter, on the right
          <g fill="var(--fg)" fillOpacity="0.16">
            <circle cx="244" cy="74" r="26" />
            <path d="M188 180c4-40 28-62 56-62s52 22 56 62z" />
          </g>
        ) : (
          // the voice, as a wave
          <g fill="var(--brand)" fillOpacity="0.35">
            {[14, 30, 46, 24, 56, 36, 20, 42, 28, 12].map((h, i) => (
              <rect key={i} x={206 + i * 10} y={92 - h / 2} width="5" height={h} rx="2.5" />
            ))}
          </g>
        )}
        <rect x="18" y="150" width="140" height="6" rx="3" fill="var(--fg)" fillOpacity="0.1" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-surface-pop/90 text-fg shadow-[var(--shadow-1)] ring-1 ring-line-2">
          {presenter ? <Play className="size-4 translate-x-px" aria-hidden /> : <AudioLines className="size-4" aria-hidden />}
        </span>
      </span>
      <FormTag form={base.form} className="absolute top-2.5 left-2.5" />
      <span className="absolute right-2.5 bottom-2 rounded-full bg-bg/70 px-2 py-0.5 text-[10.5px] text-fg-3 backdrop-blur-sm">{t('lab.example.soon')}</span>
    </div>
  )
}

/** Average render time, average cost of a video (credits, with its euros) and the form: the specs of a pipeline (on a card the
 *  form is the poster's tag). */
export function Specs({ base, estimates, testId, withForm = false }: { base: BasePipelineInfo; estimates: EstimateCardsView | null; testId: string; withForm?: boolean }) {
  const s = videoSpecs(estimates?.bases[base.id], base.doc.format.minutes)
  const creditEur = estimates?.creditEur ?? 0.01
  const cell = 'flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-surface-2 px-2.5 py-2'
  return (
    <dl className={cn('grid gap-1.5', withForm ? 'grid-cols-3' : 'grid-cols-2')} data-testid={testId}>
      <div className={cell}>
        <dt className="text-[10.5px] text-fg-3">{t('lab.spec.time')}</dt>
        <dd className="num truncate text-[13px] font-semibold text-fg" data-testid={`${testId}-time`}>
          {s.seconds !== null ? durationText(s.seconds) : t('lab.spec.unknown')}
        </dd>
      </div>
      <div className={cell} title={s.credits !== null ? t('lab.spec.cost.eur', { eur: eurOf(s.credits, creditEur), n: base.doc.format.minutes }) : t('lab.spec.unknown.hint')}>
        <dt className="text-[10.5px] text-fg-3">{t('lab.spec.cost')}</dt>
        <dd className="num truncate text-[13px] font-semibold text-fg" data-testid={`${testId}-cost`}>
          {s.credits !== null ? t('lab.spec.cost.value', { credits: creditsText(s.credits) }) : t('lab.spec.unknown')}
        </dd>
      </div>
      {withForm && (
        <div className={cell}>
          <dt className="text-[10.5px] text-fg-3">{t('lab.spec.form')}</dt>
          <dd className="truncate text-[13px] font-semibold text-fg">{t(`lab.form.${base.form}` as MessageKey)}</dd>
        </div>
      )}
    </dl>
  )
}

export interface ReadyActions {
  busy: boolean
  onUse: (b: BasePipelineInfo) => void
  onAdd: (b: BasePipelineInfo, modify: boolean) => void
}

/** « Ajouter à mes pipelines »: as is, or « Modifier » with the agent (recommended). */
function AddDialog({ base, open, onOpenChange, onPick, busy }: { base: BasePipelineInfo; open: boolean; onOpenChange: (o: boolean) => void; onPick: (modify: boolean) => void; busy: boolean }) {
  const choice = 'flex w-full items-start gap-3 rounded-[14px] border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,92vw)]" data-testid={`add-dialog-${base.id}`}>
        <DialogHeader>
          <DialogTitle className="text-[20px]">{t('lab.add.title', { name: baseName(base) })}</DialogTitle>
          <DialogDescription>{t('lab.add.body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          <button type="button" disabled={busy} onClick={() => onPick(true)} data-testid={`add-modify-${base.id}`} className={cn(choice, 'border-brand-line bg-brand-soft hover:bg-brand-soft/70')}>
            <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-fg" aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
                {t('lab.add.modify')}
                <span className="rounded-full bg-brand px-1.5 py-px text-[10px] font-semibold text-brand-ink">{t('lab.add.recommended')}</span>
              </span>
              <span className="text-[12.5px] text-fg-2">{t('lab.add.modify.hint')}</span>
            </span>
          </button>
          <button type="button" disabled={busy} onClick={() => onPick(false)} data-testid={`add-asis-${base.id}`} className={cn(choice, 'border-line-2 hover:bg-hover')}>
            <span aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold text-fg">{t('lab.add.asis')}</span>
              <span className="text-[12.5px] text-fg-3">{t('lab.add.asis.hint')}</span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** « Voir »: the pipeline in more words, its example, its specs, what can be set, and the same actions. */
function SeeDialog({ base, open, onOpenChange, estimates, actions, onAdd }: { base: BasePipelineInfo; open: boolean; onOpenChange: (o: boolean) => void; estimates: EstimateCardsView | null; actions: ReadyActions; onAdd: () => void }) {
  const main = base.options.filter((o) => optionPlace(o.id) === 'main' && o.soon === null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(620px,94vw)] gap-5" data-testid={`see-dialog-${base.id}`}>
        <DialogHeader>
          <DialogTitle className="text-[22px]">{baseName(base)}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[1.55] text-fg-2">{t(`${base.labelKey}.blurb` as MessageKey)}</DialogDescription>
        </DialogHeader>
        <ExamplePoster base={base} />
        <Specs base={base} estimates={estimates} testId={`see-specs-${base.id}`} withForm />
        {main.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-medium text-fg-2">{t('lab.see.settings')}</p>
            <div className="flex flex-wrap gap-1.5">
              {main.map((o) => (
                <span key={o.id} className="rounded-full border border-line-2 px-2.5 py-1 text-[12px] text-fg-2">
                  {t(o.labelKey as MessageKey)}
                </span>
              ))}
              <span className="px-1 py-1 text-[12px] text-fg-3">{t('lab.see.more')}</span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={actions.busy} onClick={() => actions.onUse(base)}>
            {t('lab.use')}
          </Button>
          <Button variant="secondary" disabled={actions.busy} onClick={onAdd}>
            {t('lab.add')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ReadyCard({ base, estimates, actions, className }: { base: BasePipelineInfo; estimates: EstimateCardsView | null; actions: ReadyActions; className?: string }) {
  const [adding, setAdding] = useState(false)
  const [seeing, setSeeing] = useState(false)
  return (
    <article data-testid={`base-${base.id}`} className={cn('card flex flex-col gap-3 p-3', className)}>
      <button type="button" onClick={() => setSeeing(true)} className="rounded-[12px] focus-visible:outline-2 focus-visible:outline-ring" aria-label={t('lab.see')}>
        <ExamplePoster base={base} />
      </button>
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="line-clamp-2 min-w-0 text-[15px] leading-[1.3] font-semibold tracking-[-0.014em] text-fg">{baseName(base)}</h3>
        <span className="shrink-0 text-[11.5px] text-fg-3">{base.copies > 0 ? t('lab.used.n', { n: base.copies }) : t('lab.used.none')}</span>
      </div>
      <Specs base={base} estimates={estimates} testId={`base-est-${base.id}`} />
      <div className="mt-auto flex flex-col gap-1.5">
        <Button disabled={actions.busy} onClick={() => actions.onUse(base)} data-testid={`run-${base.id}`}>
          {t('lab.use')}
        </Button>
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <Button variant="secondary" disabled={actions.busy} onClick={() => setAdding(true)} data-testid={`use-${base.id}`}>
            {t('lab.add')}
          </Button>
          <Button variant="ghost" onClick={() => setSeeing(true)} data-testid={`see-${base.id}`}>
            {t('lab.see')}
          </Button>
        </div>
      </div>
      <AddDialog
        base={base}
        open={adding}
        busy={actions.busy}
        onOpenChange={setAdding}
        onPick={(modify) => {
          setAdding(false)
          actions.onAdd(base, modify)
        }}
      />
      <SeeDialog
        base={base}
        open={seeing}
        onOpenChange={setSeeing}
        estimates={estimates}
        actions={actions}
        onAdd={() => {
          setSeeing(false)
          setAdding(true)
        }}
      />
    </article>
  )
}
