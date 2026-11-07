// « Faire préparer une pipeline par l'agent » (production-12, docs/specs/production-model.md §10.1, §13 R13.1): four ways in
// — no idea yet (the Chaînes track), a channel idea (a concept), pipelines already made (the start screen), a channel in a
// niche (its own videos, or its reference channels when it starts) —, then the agent's proposal: two or three variants with
// their price per minute and likeness, the recommended one marked, what the agent changed as visible operations, the
// questions the references leave open (answering re-applies the agent's draft, no new model call), the channels that will
// use it, and « Choisir cette pipeline », which saves it and opens it in the editor, where the owner keeps talking to the agent.
import { Compass, Lightbulb, Library, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { AgentTarget, ProposalView, VariantView } from '../../../../shared/pipeline-agent'
import { ProtoPage, SectionHead } from '@/components/proto/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useProto } from '@/proto/store'
import { call, errText } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { openRecipeNext } from '../recettes/selection'
import { Chip, PriceLine } from './parts'

function Way({ icon, title, blurb, children, testId }: { icon: React.ReactNode; title: string; blurb: string; children: React.ReactNode; testId: string }) {
  return (
    <article data-testid={testId} className="card flex flex-col gap-3 p-5">
      <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-surface-2 text-fg-2 ring-1 ring-line">
        {icon}
      </span>
      <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">{title}</h2>
      <p className="flex-1 text-[12.5px] leading-[1.5] text-fg-3">{blurb}</p>
      {children}
    </article>
  )
}

function VariantCard({ v, p, picked, onPick }: { v: VariantView; p: ProposalView; picked: boolean; onPick: () => void }) {
  return (
    <article
      data-testid={`variant-${v.kind}`}
      className={cn('card flex flex-col gap-3 p-4 transition-shadow', picked && 'ring-2 ring-ink')}
      onClick={onPick}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{t(`pagent.variant.${v.kind}` as MessageKey)}</h3>
        {p.recommended === v.kind && <Badge variant="brand">{t('pagent.recommended')}</Badge>}
      </div>
      <PriceLine perMinute={v.perMinute} perVideo={v.perVideo} minutes={v.doc.format.minutes} creditEur={p.creditEur} />
      <div>
        {v.fit !== null ? (
          <Badge variant={v.fit >= 80 ? 'ok' : v.fit >= 50 ? 'default' : 'warn'}>{t('pagent.fit', { n: v.fit })}</Badge>
        ) : (
          <span className="text-[11.5px] text-fg-4">{t('pagent.fit.none')}</span>
        )}
      </div>
      {v.why && <p className="text-[12.5px] leading-[1.5] text-fg-2">{v.why}</p>}
      <details className="text-[12px]" onClick={(e) => e.stopPropagation()}>
        <summary className="cursor-pointer text-fg-3">{t('pagent.ops', { n: v.ops.length })}</summary>
        <ul className="num mt-2 flex flex-col gap-0.5 text-[11px] text-fg-3">
          {v.ops.map((o, i) => (
            <li key={i} className="truncate" title={JSON.stringify(o)}>
              {JSON.stringify(o)}
            </li>
          ))}
        </ul>
      </details>
    </article>
  )
}

export function AgentStart({ onRoute }: ScreenProps) {
  const state = useProto()
  const channels = useMemo(() => state.channels.filter((c) => c.id.startsWith('db-')).map((c) => ({ id: Number(c.id.slice(3)), name: c.name })), [state.channels])
  const [concept, setConcept] = useState('')
  const [channelId, setChannelId] = useState<number | null>(null)
  const [refs, setRefs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<ProposalView | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<VariantView['kind'] | null>(null)
  const [assign, setAssign] = useState<number[]>([])

  const prepare = async (target: AgentTarget): Promise<void> => {
    setBusy(true)
    try {
      const p = await call('pipelineAgent.propose', target, { agent: true })
      setProposal(p)
      setAnswers({})
      setPicked(p.recommended)
      setAssign(target.kind === 'concept' ? [] : [target.channelId])
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const answer = async (id: string, value: string): Promise<void> => {
    if (!proposal) return
    const next = { ...answers, [id]: value }
    setAnswers(next)
    try {
      const p = await call('pipelineAgent.propose', proposal.target, { answers: next, draft: proposal.draft })
      setProposal({ ...p, agentNote: proposal.agentNote, model: proposal.model })
    } catch (e) {
      toast.error(errText(e))
    }
  }
  const choose = async (): Promise<void> => {
    const v = proposal?.variants.find((x) => x.kind === picked)
    if (!proposal || !v) return
    setBusy(true)
    try {
      const d = await call('pipelineAgent.adopt', { doc: v.doc, kind: v.kind, ...(proposal.draft?.summary ? { summary: proposal.draft.summary } : {}), channelIds: assign })
      toast.success(t('pagent.chosen', { name: d.name }))
      openRecipeNext(d.id)
      onRoute({ section: 'production', page: 'pipeline' })
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProtoPage testId="view-production-agent" title={t('pagent.title')} subtitle={t('pagent.subtitle')}>
      <div className="mb-9 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Way testId="way-no-idea" icon={<Compass className="size-4" />} title={t('pagent.way.noIdea')} blurb={t('pagent.way.noIdea.blurb')}>
          <Button size="sm" variant="secondary" className="self-start" onClick={() => onRoute({ section: 'chaines' })}>
            {t('pagent.way.noIdea.go')}
          </Button>
        </Way>
        <Way testId="way-concept" icon={<Lightbulb className="size-4" />} title={t('pagent.way.concept')} blurb={t('pagent.way.concept.blurb')}>
          <textarea
            data-testid="concept-text"
            rows={3}
            value={concept}
            placeholder={t('pagent.way.concept.placeholder')}
            aria-label={t('pagent.way.concept')}
            onChange={(e) => setConcept(e.target.value)}
            className="w-full resize-none rounded-md bg-surface px-3 py-2 text-[12.5px] text-fg ring-1 ring-line placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-ring"
          />
          <Button size="sm" className="self-start" disabled={busy || concept.trim().length < 3} data-testid="prepare-concept" onClick={() => void prepare({ kind: 'concept', text: concept, language: 'fr' })}>
            {t('pagent.prepare')}
          </Button>
        </Way>
        <Way testId="way-have" icon={<Library className="size-4" />} title={t('pagent.way.have')} blurb={t('pagent.way.have.blurb')}>
          <Button size="sm" variant="secondary" className="self-start" onClick={() => onRoute({ section: 'production', page: 'apercu' })}>
            {t('pagent.way.have.go')}
          </Button>
        </Way>
        <Way testId="way-niche" icon={<Sparkles className="size-4" />} title={t('pagent.way.niche')} blurb={t('pagent.way.niche.blurb')}>
          {channels.length === 0 ? (
            <p className="text-[12px] text-fg-4">{t('pagent.niche.none')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('pagent.niche.pick')}>
                {channels.map((c) => (
                  <Chip key={c.id} on={channelId === c.id} onClick={() => setChannelId(c.id)} testId={`niche-channel-${c.id}`}>
                    {c.name}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip on={!refs} onClick={() => setRefs(false)} testId="niche-own">
                  {t('pagent.niche.own')}
                </Chip>
                <Chip on={refs} onClick={() => setRefs(true)} testId="niche-refs">
                  {t('pagent.niche.refs')}
                </Chip>
              </div>
              <Button size="sm" className="self-start" disabled={busy || channelId === null} data-testid="prepare-niche" onClick={() => channelId !== null && void prepare({ kind: refs ? 'niche' : 'channel', channelId })}>
                {t('pagent.prepare')}
              </Button>
            </>
          )}
        </Way>
      </div>

      {busy && !proposal && <p className="mb-6 text-[12.5px] text-fg-3" data-testid="agent-working">{t('pagent.working')}</p>}

      {proposal && (
        <section data-testid="agent-proposal" className="mb-9">
          <SectionHead title={t('pagent.proposal')} />
          <div className="mb-4 flex flex-col gap-1.5">
            {proposal.draft?.summary && <p className="max-w-[760px] text-[13.5px] leading-[1.55] text-fg" data-testid="agent-summary">{proposal.draft.summary}</p>}
            {proposal.agentNote && <p className="text-[12.5px] text-warn">{proposal.agentNote}</p>}
            <p className="text-[12px] text-fg-3">
              {proposal.measured > 0 ? t('pagent.measured', { n: proposal.measured }) : t('pagent.measured.none')}
              {proposal.demo && <Badge variant="warn" className="ml-2">{t('pagent.demo')}</Badge>}
              {proposal.model && <span className="ml-2 text-fg-4">{t('pagent.model', { model: proposal.model })}</span>}
            </p>
            {proposal.unmeasured.length > 0 && (
              <p className="text-[12px] text-fg-4">{t('pagent.unmeasured', { list: proposal.unmeasured.map((d) => t(`fit.dim.${d}` as MessageKey).toLowerCase()).join(', ') })}</p>
            )}
          </div>
          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            {proposal.variants.map((v) => (
              <VariantCard key={v.kind} v={v} p={proposal} picked={picked === v.kind} onPick={() => setPicked(v.kind)} />
            ))}
          </div>

          {proposal.questions.length > 0 && (
            <div className="mb-6 flex flex-col gap-3" data-testid="agent-questions">
              <h3 className="text-[13px] font-semibold text-fg">{t('pagent.questions')}</h3>
              {proposal.questions.map((q) => (
                <div key={q.id} className="flex flex-col gap-1.5" data-testid={`question-${q.id}`}>
                  <span className="text-[12.5px] text-fg-2">{t(`pagent.q.${q.id}` as MessageKey)}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {q.choices.map((c) => (
                      <Chip key={c} on={(q.answer ?? q.default) === c} onClick={() => void answer(q.id, c)} testId={`answer-${q.id}-${c}`}>
                        {t(`pagent.q.${q.id}.${c}` as MessageKey)}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {channels.length > 0 && (
            <div className="mb-6 flex flex-col gap-1.5">
              <h3 className="text-[13px] font-semibold text-fg">{t('pagent.channels')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <Chip key={c.id} on={assign.includes(c.id)} onClick={() => setAssign((a) => (a.includes(c.id) ? a.filter((x) => x !== c.id) : [...a, c.id]))} testId={`assign-${c.id}`}>
                    {c.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <Button disabled={busy || picked === null} onClick={() => void choose()} data-testid="choose-variant">
            {t('pagent.choose')}
          </Button>
        </section>
      )}
    </ProtoPage>
  )
}
