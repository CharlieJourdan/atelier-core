// The pipeline editor (production-2, -3; « recette » in code): the team's pipelines on the left; on the right the
// pipeline's name, video type, format, credit cap and checkpoints, its cost per minute, its average render time and its fit
// to a channel (PipelineEstimate, production-11, pipeline-ui), the graph « Le parcours de la vidéo » (production-13), then,
// for a pipeline made from a base, its main options with their « Avant / après » (PipelineOptions) and, under « Avancé »,
// the options a user may still change and the mix. What we do not sell is never shown (pipeline-ui, Charlie 01/11): no
// engine, provider or model, no internal option or setting. A user never edits a pipeline by hand (decision 0051: « c'est
// mieux de passer par l'agent »): its options, its inputs (« Chaînes qui utilisent cette pipeline ») and « Parler à l'agent »
// change it; bricks, engines, styles, internal options and building one from scratch sit in a « Développeur » block behind
// the dev flag (`ATELIER_PIPELINE_DEV=1`, usePipelineDev). Every change is checked against the code registry by main
// (`recipes.check`); saving makes a new immutable version. Production-lab: Atlas sits beside the page (WithAtlas);
// « Ajouter → Modifier » and a pasted code open it on « Parler à l'agent »; the pipeline's code, « Partager » and
// « Exporter » (the `.atelier-recette.json` file) show only while pipeline codes are on (off in the beta).
import { Download, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import {
  DEFAULT_RECIPE_CHECKPOINTS,
  RECIPE_CHECKPOINTS,
  RECIPE_VIDEO_TYPES,
  type RecipeCheckpoint,
  type RecipeDocument,
  type RecipeIssueView,
  type RecipeMix,
  type RecipeVideoType,
  type TechnologyInfo
} from '../../../../shared/recipes'
import type { PipelineEstimateView } from '../../../../shared/estimates'
import type { GraphNodeView } from '../../../../shared/pipeline-graph'
import { ProtoPage, SectionHead } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { useProto } from '@/proto/store'
import { cn } from '@/lib/utils'
import { call, errText, useApi } from '@/state/client'
import { PipelineChannels } from '../agent/PipelineChannels'
import { PipelineChat } from '../agent/PipelineChat'
import type { ScreenProps } from '../../registry'
import { PipelineGraphCard } from '../graphe/PipelineGraphCard'
import { optionPlace } from '../../../../shared/option-previews'
import { BrickEngines } from './BrickEngines'
import { usePipelineDev } from './dev-flag'
import { useOptionPreviews } from './OptionPreview'
import { PipelineEstimate } from './PipelineEstimate'
import { MixBar, OptionFields, optionsIn, PipelineOptions } from './PipelineOptions'
import { newRecipe } from './recipe-model'
import { RecipeStages } from './RecipeStages'
import { takeAgentFocus, takeRecipeToOpen } from './selection'
import { usePipelineCodes } from './dev-flag'
import { WithAtlas } from '../lab/AtlasDock'
import { ShareCode } from '../lab/ShareCode'
import { TranslateRecipe } from './TranslateRecipe'
import { LoadLine } from './ui'

/** Name, video type, format, cap and checkpoints of a recipe. */
export function RecipeHeader({ doc, onChange }: { doc: RecipeDocument; onChange: (doc: RecipeDocument) => void }) {
  const own = doc.checkpoints !== null
  const checks = doc.checkpoints ?? [...DEFAULT_RECIPE_CHECKPOINTS]
  const toggle = (cp: RecipeCheckpoint): void => {
    const next = checks.includes(cp) ? checks.filter((c) => c !== cp) : [...checks, cp]
    onChange({ ...doc, checkpoints: RECIPE_CHECKPOINTS.filter((c) => next.includes(c)) })
  }
  return (
    <div className="@container card mb-6 flex flex-col gap-4 p-5" data-testid="recipe-header">
      {/* by the card's own width (production-lab: Atlas beside the page leaves it narrower) */}
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @4xl:grid-cols-[1.8fr_1.3fr_1.2fr_0.8fr_1.2fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-name">{t('recipeEd.name')}</Label>
          <Input id="recipe-name" value={doc.name} maxLength={120} onChange={(e) => onChange({ ...doc, name: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-type">{t('recipeEd.videoType')}</Label>
          <Select id="recipe-type" value={doc.videoType} onChange={(e) => onChange({ ...doc, videoType: e.target.value as RecipeVideoType })}>
            {RECIPE_VIDEO_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`recipe.type.${v}` as MessageKey)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-aspect">{t('recipeEd.aspect')}</Label>
          <Select id="recipe-aspect" value={doc.format.aspect} onChange={(e) => onChange({ ...doc, format: { ...doc.format, aspect: e.target.value as '16:9' | '9:16' } })}>
            <option value="16:9">{t('recipeEd.aspect.long')}</option>
            <option value="9:16">{t('recipeEd.aspect.short')}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-minutes">{t('recipeEd.minutes')}</Label>
          <Input
            id="recipe-minutes"
            inputMode="decimal"
            value={String(doc.format.minutes)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(',', '.'))
              if (Number.isFinite(n)) onChange({ ...doc, format: { ...doc.format, minutes: n } })
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-cap">{t('recipeEd.cap')}</Label>
          <Input
            id="recipe-cap"
            inputMode="numeric"
            placeholder={t('recipeEd.cap.none')}
            value={doc.capCredits === null ? '' : String(doc.capCredits)}
            onChange={(e) => {
              const v = e.target.value.trim()
              const n = Number(v)
              onChange({ ...doc, capCredits: v === '' || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)) })
            }}
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2" data-testid="recipe-checkpoints">
        <legend className="mb-1.5 text-[12.5px] font-medium text-fg-2">{t('recipeEd.checkpoints')}</legend>
        <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-fg-2">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="cp-mode" checked={!own} onChange={() => onChange({ ...doc, checkpoints: null })} />
            {t('recipeEd.checkpoints.channel')}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="cp-mode" checked={own} onChange={() => onChange({ ...doc, checkpoints: [...checks] })} />
            {t('recipeEd.checkpoints.own')}
          </label>
        </div>
        {own ? (
          <div className="flex flex-wrap gap-1.5">
            {RECIPE_CHECKPOINTS.map((cp) => (
              <button
                key={cp}
                type="button"
                aria-pressed={checks.includes(cp)}
                onClick={() => toggle(cp)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  checks.includes(cp) ? 'border-transparent bg-ink text-ink-fg' : 'border-line-2 text-fg-2 hover:bg-surface-2'
                )}
              >
                {t(`recipe.cp.${cp}` as MessageKey)}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-fg-3">{t('recipeEd.checkpoints.channelHint')}</p>
        )}
      </fieldset>
    </div>
  )
}

function Issues({ errors }: { errors: RecipeIssueView[] | null }) {
  if (errors === null) return null
  if (errors.length === 0) return <p className="text-[12.5px] text-ok" data-testid="recipe-ok">{t('recipeEd.check.ok')}</p>
  return (
    <div className="text-[12.5px] text-warn" data-testid="recipe-issues">
      <p>{t('recipeEd.check.ko')}</p>
      <ul className="mt-1 list-disc pl-5">
        {errors.slice(0, 6).map((e, i) => (
          <li key={i}>{e.message}</li>
        ))}
      </ul>
    </div>
  )
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function RecipeEditor({ onRoute }: ScreenProps) {
  const dev = usePipelineDev()
  const codes = usePipelineCodes()
  /** « Modifier avec l'agent »: bring « Parler à l'agent » into view once the pipeline is shown. */
  const [toAgent, setToAgent] = useState(() => takeAgentFocus())
  const techs = useApi('technologies.list')
  const bases = useApi('recipes.bases', ['production'])
  const list = useApi('recipes.list', ['production'])
  const [asked, setId] = useState<number | null>(() => takeRecipeToOpen())
  // the pipeline shown: the one asked for, else (a user, who never starts one by hand) the first of theirs
  const id = asked ?? (dev ? null : (list.data?.[0]?.id ?? null))
  /** The recipe as edited (null: the one loaded, or a new one, not touched yet). */
  const [edited, setDoc] = useState<RecipeDocument | null>(null)
  const [version, setVersion] = useState<{ number: number; createdAt: string } | null>(null)
  const [errors, setErrors] = useState<RecipeIssueView[] | null>(null)
  /** The mix once the options are applied (main's check), shown with the options. */
  const [mix, setMix] = useState<RecipeMix | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  /** Bumped when the agent's change was accepted: the new version is loaded. */
  const [reloads, setReloads] = useState(0)
  const all: TechnologyInfo[] = techs.data ?? []
  // the fit compares with a channel: the one chosen here, else the one in view, else the first that uses this pipeline
  const state = useProto()
  const channels = useMemo(() => state.channels.filter((c) => c.id.startsWith('db-')).map((c) => ({ id: Number(c.id.slice(3)), name: c.name })), [state.channels])
  const [fitChannel, setFitChannel] = useState<number | null | undefined>(undefined)
  const scoped = state.scope !== 'all' && state.scope.startsWith('db-') ? Number(state.scope.slice(3)) : null
  const channelId = fitChannel !== undefined ? fitChannel : (scoped ?? list.data?.find((r) => r.id === id)?.channels[0]?.channelId ?? null)
  const [estimate, setEstimate] = useState<PipelineEstimateView | null>(null)
  /** « Avancé » and the developer block open, and the brick the graph asked to open (`n`: a second click counts). */
  const [advanced, setAdvanced] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [focus, setFocus] = useState<{ brick: string; n: number } | null>(null)
  const previews = useOptionPreviews()
  const openBrick = (node: GraphNodeView): void => {
    if (node.off) {
      // a brick an option switched off: show that option (opening « Avancé » when it lives there)
      const option = node.off.option
      if (optionPlace(option) === 'advanced') setAdvanced(true)
      requestAnimationFrame(() => document.querySelector(`[data-testid="opt-${option}-field"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      return
    }
    // the developer opens the brick itself; a user, the options a user may change
    if (dev) {
      setDevOpen(true)
      setFocus({ brick: node.id, n: Date.now() })
    } else setAdvanced(true)
  }

  // a new recipe starts from the stages a video cannot do without, once the technologies are known
  const fresh = useMemo(() => (techs.data ? newRecipe(t('recipeEd.untitled'), techs.data) : null), [techs.data])
  // a new pipeline by hand: the developer only (a user creates one with the agent: « Créer une pipeline »)
  const doc = edited ?? (id === null && dev ? fresh : null)
  const base = doc?.base ? (bases.data ?? []).find((b) => b.id === doc.base) : undefined
  // open the recipe asked for
  useEffect(() => {
    if (id === null) return
    let live = true
    call('recipes.get', id).then(
      (d) => {
        if (!live) return
        setDoc(d.doc)
        setVersion({ number: d.docVersion, createdAt: d.versions[0]?.createdAt ?? d.updatedAt })
      },
      (e: unknown) => toast.error(errText(e))
    )
    return () => {
      live = false
    }
  }, [id, reloads])
  // « Modifier avec l'agent »: once the pipeline and its chat are drawn, scroll to the chat and put the cursor in it
  useEffect(() => {
    if (!toAgent || !doc || id === null) return
    const timer = setTimeout(() => {
      document.querySelector('[data-testid="pipeline-chat"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      document.querySelector<HTMLElement>('[data-testid="chat-input"]')?.focus({ preventScroll: true })
      setToAgent(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [toAgent, doc, id])
  const open = (next: number | null): void => {
    setId(next)
    setDoc(null)
    setVersion(null)
    setErrors(null)
    setMix(undefined)
    setEstimate(null)
  }

  // every change is checked by main against the registry
  useEffect(() => {
    if (!doc) return
    let live = true
    call('recipes.check', doc).then(
      (r) => {
        if (!live) return
        setErrors(r.errors)
        setMix(r.mix)
      },
      (e: unknown) => live && setErrors([{ code: 'schema', path: [], message: errText(e) }])
    )
    return () => {
      live = false
    }
  }, [doc])

  // and priced: cost per minute, per brick, Δ per option, fit to the channel (pure computation in main)
  useEffect(() => {
    if (!doc) return
    let live = true
    const timer = setTimeout(() => {
      call('estimates.pipeline', doc, channelId).then(
        (v) => live && setEstimate(v),
        () => live && setEstimate(null)
      )
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [doc, channelId])

  const deltas = estimate?.available ? { byOption: estimate.optionDeltas, creditEur: estimate.creditEur } : null
  /** The document with the mix main's check computed (the options' effect), shown with the options. */
  const shown = doc && mix !== undefined ? { ...doc, mix } : doc
  const save = async (): Promise<void> => {
    if (!doc) return
    setBusy(true)
    try {
      const d = await call('recipes.save', { ...(id !== null ? { id } : {}), doc })
      setId(d.id)
      setVersion({ number: d.docVersion, createdAt: d.versions[0]?.createdAt ?? d.updatedAt })
      toast.success(t('recipeEd.saved', { n: d.docVersion }))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const exportIt = async (): Promise<void> => {
    if (id === null) return
    try {
      const f = await call('recipes.export', id)
      download(f.fileName, f.json)
      toast.success(t('recipeEd.exported', { name: f.fileName }))
    } catch (e) {
      toast.error(errText(e))
    }
  }

  return (
    <ProtoPage
      testId="view-production-recipes"
      wide
      title={t('recipeEd.title')}
      subtitle={t('recipeEd.subtitle')}
      actions={
        <>
          {id !== null && doc && <TranslateRecipe recipeId={id} current={doc.language ?? null} onDone={(d) => open(d.id)} />}
          {codes && id !== null && doc && <ShareCode recipeId={id} name={doc.name} code={list.data?.find((r) => r.id === id)?.code ?? ''} />}
          {codes && (
            <Button variant="secondary" size="sm" disabled={id === null} onClick={() => void exportIt()} data-testid="recipe-export">
              <Download />
              {t('recipeEd.export')}
            </Button>
          )}
          <Button size="sm" disabled={busy || !doc || (errors?.length ?? 1) > 0} onClick={() => void save()} data-testid="recipe-save">
            {id === null ? t('recipeEd.save') : t('recipeEd.save.version')}
          </Button>
        </>
      }
    >
      <WithAtlas>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">

        <aside data-testid="recipe-list">
          <SectionHead title={t('recipeEd.list')} count={list.data?.length ?? 0} />
          <div className="flex flex-col gap-1">
            {dev ? (
              <button
                type="button"
                onClick={() => open(null)}
                data-testid="recipe-new"
                className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-2', id === null && 'bg-selected font-medium text-fg')}
              >
                <Plus className="size-3.5" aria-hidden />
                {t('recipeEd.new')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRoute({ section: 'production', page: 'style' })}
                data-testid="recipe-create"
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-2"
              >
                <Plus className="size-3.5" aria-hidden />
                {t('prodStart.create')}
              </button>
            )}
            {(list.data ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => open(r.id)}
                className={cn('truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-fg-2 transition-colors hover:bg-surface-2', id === r.id && 'bg-selected font-medium text-fg')}
              >
                {r.name} <span className="num text-fg-4">v{r.version}</span>
              </button>
            ))}
            {list.data && list.data.length === 0 && <p className="px-2.5 py-1.5 text-[12px] text-fg-4">{t('recipeEd.list.empty')}</p>}
          </div>
        </aside>
        <div className="min-w-0">
          <LoadLine error={techs.error ?? list.error} loading={!doc && !techs.error && !(id === null && !dev && list.data?.length === 0)} />
          {!doc && id === null && !dev && list.data?.length === 0 && (
            <div className="card flex flex-col items-start gap-3 p-6" data-testid="recipe-none">
              <p className="text-[13px] text-fg-2">{t('recipeEd.none')}</p>
              <Button onClick={() => onRoute({ section: 'production', page: 'style' })}>{t('prodStart.create')}</Button>
            </div>
          )}
          {doc && (
            <>
              <RecipeHeader doc={doc} onChange={setDoc} />
              <PipelineEstimate view={estimate} base={base} channels={channels} channelId={channelId} onChannel={setFitChannel} />
              <PipelineGraphCard doc={doc} channelId={channelId} estimate={estimate} onOpen={openBrick} />
              {id !== null && <PipelineChat recipeId={id} channelId={channelId} onSaved={() => setReloads((n) => n + 1)} />}
              {base ? (
                <>
                  <PipelineOptions base={base} doc={shown ?? doc} deltas={deltas} previews={previews} onChange={(d) => setDoc({ ...d, mix: doc.mix })} />
                  <details className="mb-6" data-testid="pipe-advanced" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
                    <summary className="cursor-pointer text-[13px] font-semibold text-fg">
                      {t('pipe.advanced')} <span className="font-normal text-fg-3">— {t('pipe.advanced.hint')}</span>
                    </summary>
                    <div className="card mt-4 flex flex-col gap-5 p-5" data-testid="pipe-advanced-options">
                      <OptionFields options={optionsIn(base, 'advanced')} doc={shown ?? doc} deltas={deltas} previews={previews} onChange={(d) => setDoc({ ...d, mix: doc.mix })} />
                      <MixBar mix={(shown ?? doc).mix} />
                    </div>
                  </details>
                </>
              ) : (
                !dev && (
                  <p className="mb-6 text-[12.5px] text-fg-3" data-testid="pipe-by-agent">
                    {t('pipe.byAgent')}
                  </p>
                )
              )}
              {dev && (
                <details className="mb-6" data-testid="pipe-dev" open={devOpen} onToggle={(e) => setDevOpen(e.currentTarget.open)}>
                  <summary className="cursor-pointer text-[13px] font-semibold text-fg">
                    {t('pipe.dev')} <span className="font-normal text-fg-3">— {t('pipe.dev.hint')}</span>
                  </summary>
                  <div className="mt-4 flex flex-col gap-6">
                    {base && (
                      <div className="card p-5" data-testid="pipe-dev-options">
                        <OptionFields options={base.options.filter((o) => optionPlace(o.id) === 'internal')} doc={shown ?? doc} deltas={deltas} previews={previews} onChange={(d) => setDoc({ ...d, mix: doc.mix })} />
                      </div>
                    )}
                    <RecipeStages doc={doc} techs={all} onChange={setDoc} focus={focus} />
                    <BrickEngines doc={doc} techs={all} onChange={setDoc} />
                  </div>
                </details>
              )}
              {id !== null && <PipelineChannels recipeId={id} channels={channels} />}
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4">
                <Issues errors={errors} />
                {version && <span className="num text-[12px] text-fg-3">{t('recipeEd.version', { n: version.number, date: version.createdAt.slice(0, 10) })}</span>}
              </div>
            </>
          )}
        </div>
      </div>
      </WithAtlas>
    </ProtoPage>
  )
}
