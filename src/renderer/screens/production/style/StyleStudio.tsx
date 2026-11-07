// « Créer une pipeline » (production-15, docs/specs/production-model.md §10.3, Charlie 01/11). The simple path: a few words
// and (strongly recommended) 1 to 5 example videos → « Créer » (the eyes measure the examples) → two or three pipelines with
// their price per minute, a free likeness estimate and the saved previews of their pictures, clips and presenter (free) →
// « Voir un exemple » (its quote first; nothing is spent before « Lancer l'exemple ») → the sample, its score out of 100 and
// its three biggest gaps (« Corriger » applies the edit, then « Refaire l'exemple ») → « Utiliser cette pipeline ». Engines,
// styles and the agent's operations sit under « Avancé » only. The consent rule is said on the screen: a style, never a person.
import { ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { ChannelFormatId, StudyInput, StudyPath, StudyView, StyleMeasureView, StyleVariantView } from '../../../../shared/style-agent'
import { ProtoPage, SectionHead } from '@/components/proto/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useProto } from '@/proto/store'
import { call, errText, useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Chip, PriceLine } from '../agent/parts'
import { eurOf } from '../recettes/estimate-format'
import { openRecipeNext } from '../recettes/selection'
import { PreviewStrip } from './Previews'
import { Differentiators } from './Differentiators'
import { Ingredients } from './Ingredients'
import { PathForm, PathPicker } from './PathForm'
import { takeStudyPath } from './path-next'
import { Feasibility } from './Feasibility'
import { Insights, Inspirations, Timing } from './StudyFacts'
import { StyleSample } from './StyleSample'

const pct = (x: number | null): string => (x === null ? t('pstyle.profile.unknown') : `${Math.round(x * 100)} %`)
const has = (key: string): boolean => t(key as MessageKey) !== key
const word = (prefix: string, v: string): string => (has(`${prefix}.${v}`) ? t(`${prefix}.${v}` as MessageKey) : v)
const KIND_WORDS: Record<string, string> = { imageAi: 'pipe.mix.imageAi', clipAi: 'pipe.mix.clipAi', stock: 'pipe.mix.stock', archive: 'pipe.mix.archive', motion: 'pipe.mix.motion', userFootage: 'pipe.mix.userFootage' }

function ProfileLine({ p }: { p: StyleMeasureView }) {
  const kinds = p.kinds
    ? Object.entries(p.kinds)
        .filter(([, v]) => v > 0.02)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${has(KIND_WORDS[k] ?? '') ? t(KIND_WORDS[k] as MessageKey) : k} ${Math.round(v * 100)} %`)
        .join(', ')
    : t('pstyle.profile.unknown')
  // a presenter who talks little but acts in the pictures is still the channel's presenter (style-japanese)
  const acting = typeof p.presenterActs === 'number' && p.presenterActs >= 0.15
  const presenter =
    p.presenterShare === null
      ? t('pstyle.profile.unknown')
      : acting
        ? t('pstyle.profile.acts', { talk: pct(p.presenterShare), acts: pct(p.presenterActs ?? null) })
        : p.presenterShare < 0.03
          ? t('pstyle.profile.none')
          : `${pct(p.presenterShare)}${p.layouts.length ? ` (${p.layouts.map((l) => word('pstyle.layout', l)).join(', ')})` : ''}`
  const items: [string, string][] = [
    [t('pstyle.profile.presenter'), presenter],
    [t('pstyle.profile.pictures'), kinds],
    [t('pstyle.profile.look'), p.lookFamily ? word('pstyle.look', p.lookFamily) : t('pstyle.profile.unknown')],
    [t('pstyle.profile.shot'), p.shotS === null ? t('pstyle.profile.unknown') : t('pstyle.profile.seconds', { n: p.shotS.toFixed(1).replace('.', ',') })],
    [t('pstyle.profile.pace'), p.wordsPerMinute === null ? t('pstyle.profile.unknown') : t('pstyle.profile.wpm', { n: Math.round(p.wordsPerMinute) })],
    [t('pstyle.profile.captions'), p.captions === null ? t('pstyle.profile.unknown') : p.captions ? t('pstyle.profile.yes') : t('pstyle.profile.no')],
    [t('pstyle.profile.offer'), p.offerAtS === null ? t('pstyle.profile.offer.none') : t('pstyle.profile.offer.at', { t: `${Math.floor(p.offerAtS / 60)}:${String(Math.round(p.offerAtS % 60)).padStart(2, '0')}` })],
    ...(p.light ? [[t('pstyle.profile.light'), word('pstyle.light', p.light)] as [string, string]] : []),
    ...(p.camera ? [[t('pstyle.profile.camera'), word('pstyle.camera', p.camera)] as [string, string]] : [])
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4 xl:grid-cols-7" data-testid="style-profile">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className="text-[11px] uppercase tracking-[0.04em] text-fg-3">{k}</dt>
          <dd className="text-[12.5px] text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function VariantCard({ v, s, busy, onSee, onUse }: { v: StyleVariantView; s: StudyView; busy: boolean; onSee: () => void; onUse: () => void }) {
  const recommended = s.recommended === v.kind
  return (
    <article data-testid={`style-variant-${v.kind}`} className={cn('card flex flex-col gap-3 p-4', recommended && 'ring-2 ring-ink')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{t(`pagent.variant.${v.kind}` as MessageKey)}</h3>
        {recommended && <Badge variant="brand">{t('pagent.recommended')}</Badge>}
      </div>
      {/* the pipeline's name, and its language when the channel is translated (parcours-utilisateur: it was seen only once saved) */}
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2" data-testid={`style-name-${v.kind}`}>
        {v.doc.name}
        {s.language && <Badge variant="outline">{has(`pstyle.language.${s.language}`) ? t(`pstyle.language.${s.language}` as MessageKey) : s.language.toUpperCase()}</Badge>}
      </span>
      <PriceLine perMinute={v.perMinute} perVideo={v.perMinute ? { min: v.perMinute.min * v.doc.format.minutes, avg: v.perMinute.avg * v.doc.format.minutes, max: v.perMinute.max * v.doc.format.minutes } : null} minutes={v.doc.format.minutes} creditEur={s.creditEur} />
      {v.likeness !== null ? (
        <div className="flex flex-col gap-0.5" title={t('pstyle.estimate.help')}>
          <span className="flex items-baseline gap-1.5">
            <span className="num text-[15px] font-semibold text-fg" data-testid={`style-estimate-${v.kind}`}>
              {Math.max(0, v.likeness - 10)}–{v.likeness}
            </span>
            <span className="text-[12px] text-fg-3">/ 100 · {t('pstyle.estimate')}</span>
          </span>
          <span className="text-[11px] text-fg-3">{t('pstyle.estimate.help')}</span>
        </div>
      ) : (
        <span className="text-[11.5px] text-fg-3">{t(s.demo ? 'pstyle.estimate.demo' : 'pstyle.estimate.none')}</span>
      )}
      {s.differentiators.some((d) => d.picked) && (
        <span className="flex flex-wrap gap-1" data-testid={`style-picked-${v.kind}`}>
          {s.differentiators
            .filter((d) => d.picked)
            .map((d) => (
              <Badge key={d.id} variant="ok">
                {d.title}
              </Badge>
            ))}
        </span>
      )}
      <PreviewStrip doc={v.doc} testId={`style-previews-${v.kind}`} />
      {v.edits > 0 && <Badge variant="ok">{t('pstyle.edits', { n: v.edits })}</Badge>}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" variant={recommended ? 'default' : 'secondary'} disabled={busy} onClick={onSee} data-testid={`style-see-${v.kind}`}>
          {t('pstyle.see')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onUse} data-testid={`style-use-${v.kind}`}>
          {s.rework ? t('ppath.rework.save') : t('pstyle.use')}
        </Button>
      </div>
    </article>
  )
}

function QuotePanel({ s, channels, busy, onRun, onCancel, onScript, onChannel }: { s: StudyView; channels: { id: number; name: string }[]; busy: boolean; onRun: () => void; onCancel: () => void; onScript: (text: string) => void; onChannel: (id: number) => void }) {
  const q = s.quote
  const [text, setText] = useState(s.script)
  if (!q) return null
  return (
    <section className="card mb-9 flex flex-col gap-4 p-5" data-testid="style-quote">
      <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{t('pstyle.quote.title')}</h2>
      <p className="max-w-[760px] text-[13px] leading-[1.55] text-fg-2" data-testid="style-quote-body">
        {t('pstyle.quote.body', { s: q.seconds, variant: t(`pagent.variant.${q.variant}` as MessageKey), credits: q.credits.avg, eur: eurOf(q.credits.avg, s.creditEur), min: q.credits.min, max: q.credits.max })}
      </p>
      {q.hold !== null && q.debited && q.hold > q.credits.max && (
        <p className="max-w-[760px] text-[12px] leading-[1.5] text-fg-3" data-testid="style-quote-hold">
          {t('pstyle.quote.hold', { hold: q.hold })}
        </p>
      )}
      {!q.debited && <p className="text-[12px] text-fg-3">{t('pstyle.quote.demo')}</p>}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-fg-3">{t('pstyle.quote.script')}</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} className="w-full max-w-[760px] resize-none rounded-md bg-surface px-3 py-2 text-[12.5px] text-fg ring-1 ring-line focus-visible:outline-2 focus-visible:outline-ring" data-testid="style-script" />
      </label>
      {text.trim() !== s.script && (
        <Button size="sm" variant="secondary" className="self-start" disabled={busy} onClick={() => onScript(text)}>
          {t('pstyle.script.save')}
        </Button>
      )}
      {channels.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-fg-3">{t('pstyle.quote.channel')}</span>
          <div className="flex flex-wrap gap-1.5">
            {channels.map((c) => (
              <Chip key={c.id} on={s.channelId === c.id} onClick={() => onChannel(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || text.trim() !== s.script} onClick={onRun} data-testid="style-run">
          {t('pstyle.quote.run', { credits: q.credits.avg })}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('pstyle.quote.cancel')}
        </Button>
      </div>
    </section>
  )
}

export function StyleStudio({ onRoute }: ScreenProps) {
  const state = useProto()
  const channels = useMemo(() => state.channels.filter((c) => c.id.startsWith('db-')).map((c) => ({ id: Number(c.id.slice(3)), name: c.name })), [state.channels])
  const history = useApi('style.list', ['production'])
  // the way in (parcours-utilisateur): the Lab's « Créer une pipeline » may have chosen it
  const [path, setPath] = useState<StudyPath>(() => takeStudyPath() ?? 'clone')
  const [lastInput, setLastInput] = useState<StudyInput | null>(null)
  // a new study comes into view once (its results sit under the form)
  const scrolled = useRef<number | null>(null)
  const [study, setStudy] = useState<StudyView | null>(null)
  const [busy, setBusy] = useState(false)
  const [hideQuote, setHideQuote] = useState(false)

  const act = useCallback(async (f: () => Promise<StudyView>): Promise<void> => {
    setBusy(true)
    try {
      setStudy(await f())
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }, [])

  // the sample's run is read again while it runs
  const running = study?.sample?.status === 'running'
  const studyId = study?.id
  useEffect(() => {
    if (!running || studyId === undefined) return
    const h = setInterval(() => {
      call('style.get', studyId).then(setStudy, () => undefined)
    }, 2000)
    return () => clearInterval(h)
  }, [running, studyId])

  const choose = (p: StudyPath): void => {
    setPath(p)
    setStudy(null)
  }
  const analyse = (input: StudyInput): Promise<void> => {
    setLastInput(input)
    setStudy(null)
    return act(() => call('style.study', input))
  }
  // « Prendre ce format » : the same study, measured on another format of the channel
  const reformat = (format: ChannelFormatId): Promise<void> => (lastInput ? analyse({ ...lastInput, format }) : Promise.resolve())
  const quote = (variant: string): Promise<void> => {
    setHideQuote(false)
    return act(() => call('style.quote', (study as StudyView).id, variant))
  }
  const use = async (variant: string): Promise<void> => {
    if (!study) return
    setBusy(true)
    try {
      const d = await call('style.adopt', study.id, variant)
      toast.success(study.rework ? t('ppath.rework.saved', { name: d.name }) : t('pstyle.used', { name: d.name }))
      openRecipeNext(d.id)
      onRoute({ section: 'production', page: 'pipeline' })
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProtoPage testId="view-production-style" title={t('pstyle.title')} subtitle={t('pstyle.subtitle')}>
      <p className="mb-6 flex max-w-[860px] items-start gap-2 rounded-field bg-surface-2 px-3 py-2 text-[12px] leading-[1.5] text-fg-2 ring-1 ring-line" data-testid="style-consent">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
        {t('pstyle.consent')}
      </p>

      <PathPicker path={path} onPath={choose} />
      <PathForm key={path} path={path} busy={busy} onGo={(input) => void analyse(input)} />
      {(history.data ?? []).length > 0 && (
        <div className="-mt-5 mb-9 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-fg-3">{t('pstyle.history')}</span>
          {(history.data ?? []).slice(0, 5).map((h) => (
            <Chip key={h.id} on={study?.id === h.id} onClick={() => void act(() => call('style.get', h.id))}>
              {h.title.slice(0, 40)}
            </Chip>
          ))}
        </div>
      )}
      {busy && !study && <p className="mb-9 text-[12.5px] text-fg-3" data-testid="style-working">{t('pstyle.working')}</p>}

      {study && (
        <>
          <section ref={(el) => {
              if (!el || scrolled.current === study.id) return
              scrolled.current = study.id
              el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }} className="mb-9 flex scroll-mt-4 flex-col gap-4" data-testid="style-study">
            {study.references.length > 0 && <SectionHead title={t('pstyle.refs')} count={study.references.length} />}
            <div className="flex flex-wrap gap-2">
              {study.references.map((r) => (
                <span key={r.url} className="rounded-field bg-surface px-3 py-1.5 text-[12px] ring-1 ring-line" title={r.url}>
                  <span className="font-medium text-fg">{r.title.slice(0, 60)}</span>
                  <span className="ml-2 text-fg-3">{r.problem ? t('pstyle.ref.problem', { why: r.problem }) : t('pstyle.ref.videos', { n: r.videos })}</span>
                </span>
              ))}
            </div>
            {study.references.some((r) => r.coverage?.length) && (
              <ul className="flex flex-col gap-0.5 text-[12px] text-fg-3" data-testid="style-coverage">
                {study.references.flatMap((r) => (r.coverage ?? []).map((c, i) => <li key={`${r.url}-${i}`} className={/en partie|seulement/.test(c) ? 'text-warn' : ''}>{c}</li>))}
              </ul>
            )}
            {study.demo && !study.agentNote && <p className="text-[12px] text-warn">{t('pstyle.demo')}</p>}
            {study.profile && <ProfileLine p={study.profile} />}
            {study.summary && <p className="max-w-[760px] text-[13.5px] leading-[1.55] text-fg" data-testid="style-summary">{study.summary}</p>}
            {study.agentNote && <p className="text-[12.5px] text-warn">{study.agentNote}</p>}
            <p className="text-[12px] text-fg-3" data-testid="style-reason">
              {t(`pstyle.reason.${study.reason}` as MessageKey, { base: t(`pipe.base.${study.base.replace(/@\d+$/, '').replace('story-short', 'storyShort')}` as MessageKey) })}
              {study.measureCredits > 0 && <span className="ml-2 text-fg-3">{t('pstyle.measureCost', { credits: study.measureCredits })}</span>}
            </p>
          </section>

          <Feasibility study={study} />
          <Insights study={study} busy={busy} onFormat={(f) => void reformat(f)} />
          <Inspirations study={study} />
          <Timing study={study} />
          <Ingredients study={study} busy={busy} onChoose={(ing, option) => void act(() => call('style.choose', study.id, ing, option))} />
          <Differentiators study={study} busy={busy} onPick={(ids) => void act(() => call('style.pick', study.id, ids))} />

          <section className="mb-9" data-testid="style-proposals">
            <SectionHead title={study.rework ? t('ppath.rework.yours', { name: study.rework.name }) : t('pstyle.proposals')} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {study.variants.map((v) => (
                <VariantCard key={v.kind} v={v} s={study} busy={busy} onSee={() => void quote(v.kind)} onUse={() => void use(v.kind)} />
              ))}
            </div>
            {study.questions.length > 0 && (
              <div className="mt-5 flex flex-col gap-3">
                <h3 className="text-[13px] font-semibold text-fg">{t('pagent.questions')}</h3>
                {study.questions.map((q) => (
                  <div key={q.id} className="flex flex-col gap-1.5">
                    <span className="text-[12.5px] text-fg-2">{t(`pagent.q.${q.id}` as MessageKey)}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {q.choices.map((c) => (
                        <Chip key={c} on={(q.answer ?? q.default) === c} onClick={() => void act(() => call('style.answer', study.id, { [q.id]: c }))}>
                          {t(`pagent.q.${q.id}.${c}` as MessageKey)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {!hideQuote && study.quote && (
            <QuotePanel
              key={`${study.quote.id}-${study.script}`}
              s={study}
              channels={channels}
              busy={busy}
              onRun={() => study.quote && void act(() => call('style.sample', study.id, study.quote?.variant ?? '', study.quote?.id ?? ''))}
              onCancel={() => setHideQuote(true)}
              onScript={(text) => void act(() => call('style.script', study.id, text)).then(() => study.quote && quote(study.quote.variant))}
              onChannel={(id) => void act(() => call('style.channel', study.id, id)).then(() => study.quote && quote(study.quote.variant))}
            />
          )}
          {study.sample && <StyleSample study={study} busy={busy} onGap={(i) => void act(() => call('style.applyGap', study.id, i)).then(() => toast.success(t('pstyle.gap.done')))} onRedo={() => study.sample && void quote(study.sample.variant)} />}
        </>
      )}
    </ProtoPage>
  )
}
