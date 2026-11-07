// « Objectifs et validations » of a channel (Chaînes › fiche › Automatisation, docs/AGENT-RUNTIME.md §25): the standing goals
// proposed when the channel was created or imported (slots, formats and lengths, monthly budget in credits, deadlines, the
// reasons) and its approval level; Charlie confirms them, or edits then confirms. The smallest UI on purpose: the rich
// onboarding « Objectifs » step comes when onboarding resumes. Real mode only (IPC).
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { APPROVAL_LEVELS, GOAL_GATES, type ApprovalLevel, type ChannelGoals, type ChannelGoalsInput, type GoalFormat, type GoalGate, type GoalSlot } from '../../../shared/api/autopilot'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { AllowRules } from './AllowRules'

type Draft = Required<Pick<ChannelGoalsInput, 'slots' | 'formats' | 'budgetCredits' | 'level' | 'gates'>>

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const
const dayName = (d: number): string => t(`goals.day.${d}` as MessageKey)

function formatLine(f: GoalFormat): string {
  return t('goals.format.line', { n: f.perWeek, kind: t(f.kind === 'short' ? 'goals.format.short' : 'goals.format.long'), min: f.minutes })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[150px_1fr] sm:gap-4">
      <span className="micro-label pt-0.5">{label}</span>
      <div className="min-w-0 text-[13px] text-fg-2">{children}</div>
    </div>
  )
}

export function GoalsPanel({ channelId }: { channelId: number }) {
  // wrapped, so that « not loaded yet » (data null) and « no goals yet » (goals null) differ
  const goals = useLoader(() => call('autopilot.goals', channelId).then((v) => ({ goals: v })), `goals-${channelId}`, ['orchestra'])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, done: MessageKey) => {
    setBusy(true)
    try {
      await fn()
      setDraft(null)
      goals.reload()
      toast.success(t(done))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  const save = (confirm: boolean) => run(() => call('autopilot.saveGoals', channelId, { ...(draft ?? {}), confirm }), confirm ? 'goals.confirmed' : 'goals.saved')
  const propose = () => run(() => call('autopilot.proposeGoals', channelId), 'goals.saved')

  const g: ChannelGoals | null = goals.data?.goals ?? null
  return (
    <Panel title={t('goals.title')} data-testid="channel-goals" className="mb-6">
      {goals.error ? (
        <ErrorLine message={goals.error} onRetry={goals.reload} />
      ) : goals.data === null ? (
        <LoadingBlock rows={3} />
      ) : !g ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-fg-3">{t('goals.none')}</p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void propose()}>
            {t('goals.propose')}
          </Button>
        </div>
      ) : draft ? (
        <Editor draft={draft} onChange={setDraft} busy={busy} onSave={save} onCancel={() => setDraft(null)} />
      ) : (
        <>
          <p className="mb-2 text-[12.5px]" data-testid="channel-goals-status" data-status={g.status}>
            <span className={g.status === 'confirmed' ? 'font-medium text-ok' : 'font-medium text-warn'}>{t(`goals.status.${g.status}` as MessageKey)}</span>
            <span className="text-fg-3"> · {t(`goals.source.${g.source}` as MessageKey)}</span>
          </p>
          <div className="divide-y divide-line">
            <Row label={t('goals.slots')}>{g.slots.length ? g.slots.map((s) => `${dayName(s.day)} ${s.time}${s.kind === 'short' ? ` (${t('goals.format.short')})` : ''}`).join(' · ') : t('goals.slots.none')}</Row>
            <Row label={t('goals.formats')}>{g.formats.map(formatLine).join(' · ')}</Row>
            <Row label={t('goals.budget')}>
              <span className="num">{t('goals.budget.value', { n: g.budgetCredits.toLocaleString('fr-FR'), eur: Math.round(g.budgetCredits / 100) })}</span>
            </Row>
            {g.deadlines.length > 0 && <Row label={t('goals.deadlines')}>{g.deadlines.map((d) => `${d.label} : ${new Date(d.date).toLocaleDateString('fr-FR')}`).join(' · ')}</Row>}
            <Row label={t('goals.level')}>
              {t(`goals.level.${g.level}` as MessageKey)}
              {g.level === 'custom' && <span className="text-fg-3"> · {g.gates.length ? g.gates.map((x) => t(`goals.gate.${x}` as MessageKey)).join(', ') : t('goals.gates.none')}</span>}
            </Row>
            <Row label={t('goals.reasons')}>
              <span className="text-fg-3">{g.reasons}</span>
            </Row>
            <AllowRules channelId={channelId} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {g.status === 'proposed' && (
              <Button size="sm" data-testid="channel-goals-confirm" disabled={busy} onClick={() => void save(true)}>
                {t('goals.confirm')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              data-testid="channel-goals-edit"
              disabled={busy}
              onClick={() => setDraft({ slots: g.slots, formats: g.formats, budgetCredits: g.budgetCredits, level: g.level, gates: g.gates })}
            >
              {t('goals.edit')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void propose()}>
              {t('goals.repropose')}
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}

function Editor({ draft, onChange, busy, onSave, onCancel }: { draft: Draft; onChange: (d: Draft) => void; busy: boolean; onSave: (confirm: boolean) => void; onCancel: () => void }) {
  const setSlot = (i: number, patch: Partial<GoalSlot>) => onChange({ ...draft, slots: draft.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const setFormat = (i: number, patch: Partial<GoalFormat>) => onChange({ ...draft, formats: draft.formats.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const toggleGate = (gate: GoalGate) => onChange({ ...draft, gates: draft.gates.includes(gate) ? draft.gates.filter((x) => x !== gate) : [...draft.gates, gate] })
  return (
    <div data-testid="channel-goals-editor" className="divide-y divide-line">
      <Row label={t('goals.slots')}>
        <div className="flex flex-col gap-2">
          {draft.slots.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label={t('goals.slots')} value={s.day} onChange={(e) => setSlot(i, { day: Number(e.target.value) })} className="w-36">
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {dayName(d)}
                  </option>
                ))}
              </Select>
              <Input type="time" aria-label={t('goals.slots')} value={s.time} onChange={(e) => setSlot(i, { time: e.target.value })} className="w-28" />
              <Select aria-label={t('goals.formats')} value={s.kind} onChange={(e) => setSlot(i, { kind: e.target.value === 'short' ? 'short' : 'long' })} className="w-36">
                <option value="long">{t('goals.format.long')}</option>
                <option value="short">{t('goals.format.short')}</option>
              </Select>
              <Button size="icon" variant="ghost" aria-label={t('goals.slot.remove')} onClick={() => onChange({ ...draft, slots: draft.slots.filter((_, j) => j !== i) })}>
                <X aria-hidden />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => onChange({ ...draft, slots: [...draft.slots, { day: 1, time: '18:00', kind: 'long' }] })}>
            <Plus aria-hidden /> {t('goals.slot.add')}
          </Button>
        </div>
      </Row>
      <Row label={t('goals.formats')}>
        <div className="flex flex-col gap-2">
          {draft.formats.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-28">{t(f.kind === 'short' ? 'goals.format.short' : 'goals.format.long')}</span>
              <label className="flex items-center gap-1.5 text-[12px] text-fg-3">
                {t('goals.format.minutes')}
                <Input type="number" min={1} max={240} value={f.minutes} onChange={(e) => setFormat(i, { minutes: Number(e.target.value) })} className="w-20" />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-fg-3">
                {t('goals.format.perWeek')}
                <Input type="number" min={0} max={21} value={f.perWeek} onChange={(e) => setFormat(i, { perWeek: Number(e.target.value) })} className="w-20" />
              </label>
            </div>
          ))}
        </div>
      </Row>
      <Row label={t('goals.budget')}>
        <Input type="number" min={0} step={100} aria-label={t('goals.budget')} value={draft.budgetCredits} onChange={(e) => onChange({ ...draft, budgetCredits: Number(e.target.value) })} className="w-36" />
      </Row>
      <Row label={t('goals.level')}>
        <Select aria-label={t('goals.level')} data-testid="channel-goals-level" value={draft.level} onChange={(e) => onChange({ ...draft, level: e.target.value as ApprovalLevel })} className="max-w-[340px]">
          {APPROVAL_LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(`goals.level.${l}` as MessageKey)}
            </option>
          ))}
        </Select>
        {draft.level === 'custom' && (
          <div className="mt-2 flex flex-wrap gap-3">
            {GOAL_GATES.map((gate) => (
              <label key={gate} className="flex items-center gap-1.5 text-[12.5px]">
                <input type="checkbox" checked={draft.gates.includes(gate)} onChange={() => toggleGate(gate)} />
                {t(`goals.gate.${gate}` as MessageKey)}
              </label>
            ))}
          </div>
        )}
      </Row>
      <div className="flex flex-wrap gap-2 pt-3">
        <Button size="sm" data-testid="channel-goals-save-confirm" disabled={busy} onClick={() => onSave(true)}>
          {t('goals.saveConfirm')}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSave(false)}>
          {t('goals.save')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('goals.cancel')}
        </Button>
      </div>
    </div>
  )
}
