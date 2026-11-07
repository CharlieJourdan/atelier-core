// Production › Automatisations: the form of a rule « lancer le pipeline Atelier pour une chaîne » (create or edit).
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { CADENCES, type AutomationInput, type AutomationRow, type Cadence } from '../../../shared/api/ideas'
import { ErrorLine, Field } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input, Select, Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'
import { WEEKDAYS, budgetLabel, gateLabel, hourLabel, weekdayLabel } from './common'

const HOURS = Array.from({ length: 24 }, (_, h) => h)

export function AutomationForm({ initial, channels, onClose }: { initial: AutomationRow | null; channels: { id: number; name: string }[]; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [channelId, setChannelId] = useState(String(initial?.channelId ?? channels[0]?.id ?? ''))
  const [cadence, setCadence] = useState<Cadence>(initial?.cadence ?? 'daily')
  const [weekday, setWeekday] = useState(String(initial?.weekday ?? 1))
  const [hour, setHour] = useState(String(initial?.hour ?? 8))
  const [topicFrom, setTopicFrom] = useState<AutomationInput['topicFrom']>(initial?.topicFrom ?? 'ideas')
  const [topic, setTopic] = useState(initial?.topic ?? '')
  const [minutes, setMinutes] = useState(String(initial?.minutes ?? 5).replace('.', ','))
  const [budgetMode, setBudgetMode] = useState<AutomationInput['budgetMode']>(initial?.budgetMode ?? 'usage_max')
  const [gateMode, setGateMode] = useState<AutomationInput['gateMode']>(initial?.gateMode ?? 'step')
  const [enabled, setEnabled] = useState(initial?.enabled ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const input: AutomationInput = {
      name,
      channelId: Number(channelId),
      cadence,
      weekday: cadence === 'weekly' ? Number(weekday) : null,
      hour: Number(hour),
      topicFrom,
      topic: topicFrom === 'fixed' ? topic : '',
      minutes: Number(minutes.replace(',', '.')),
      budgetMode,
      gateMode,
      enabled: cadence === 'manual' ? false : enabled
    }
    setBusy(true)
    try {
      if (initial) await call('automations.update', initial.id, input)
      else await call('automations.create', input)
      toast.success(t(initial ? 'automations.saved' : 'automations.created'))
      onClose()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('automations.field.name')} htmlFor="auto-name" className="col-span-2">
          <Input id="auto-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </Field>
        <Field label={t('automations.field.channel')} htmlFor="auto-channel">
          <Select id="auto-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('automations.field.cadence')} htmlFor="auto-cadence">
          <Select id="auto-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {t(`automations.cadence.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        {cadence === 'weekly' && (
          <Field label={t('automations.field.weekday')} htmlFor="auto-weekday">
            <Select id="auto-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {weekdayLabel(d)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {cadence !== 'manual' && (
          <Field label={t('automations.field.hour')} htmlFor="auto-hour">
            <Select id="auto-hour" value={hour} onChange={(e) => setHour(e.target.value)}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('automations.field.topicFrom')} htmlFor="auto-topic-from">
          <Select id="auto-topic-from" value={topicFrom} onChange={(e) => setTopicFrom(e.target.value as AutomationInput['topicFrom'])}>
            <option value="ideas">{t('automations.topic.ideas')}</option>
            <option value="fixed">{t('automations.topic.fixed')}</option>
          </Select>
        </Field>
        {topicFrom === 'fixed' && (
          <Field label={t('automations.field.topic')} htmlFor="auto-topic">
            <Input id="auto-topic" value={topic} onChange={(e) => setTopic(e.target.value)} required />
          </Field>
        )}
        <Field label={t('automations.field.minutes')} htmlFor="auto-minutes">
          <Input id="auto-minutes" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <Field label={t('automations.field.budget')} htmlFor="auto-budget">
          <Select id="auto-budget" value={budgetMode} onChange={(e) => setBudgetMode(e.target.value as AutomationInput['budgetMode'])}>
            {(['usage_max', 'qualite_max'] as const).map((m) => (
              <option key={m} value={m}>
                {budgetLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('automations.field.gate')} htmlFor="auto-gate">
          <Select id="auto-gate" value={gateMode} onChange={(e) => setGateMode(e.target.value as AutomationInput['gateMode'])}>
            {(['step', 'all'] as const).map((m) => (
              <option key={m} value={m}>
                {gateLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {cadence !== 'manual' && (
        <label className="flex items-center gap-3 text-[13px] text-fg-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('automations.field.enabled')} />
          {t('automations.field.enabled')}
        </label>
      )}
      <p className="text-[12px] text-fg-3">{t('automations.form.cost')}</p>
      {error && <ErrorLine message={error} />}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('automations.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !name.trim() || !channelId}>
          {t('automations.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
