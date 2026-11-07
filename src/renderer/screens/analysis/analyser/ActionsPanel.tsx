// The two exits of an analysis: « Créer le pipeline » (pick a channel, then the Pipelines page) and « Contacter le support »
// (a request kept in the app; the e-mail is sent only once the support address exists, see the features registry).
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { AnalysisDetail } from '../../../../shared/analysis'
import { DemoBoundary } from '@/components/atelier/demo'
import { Field } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'
import { useChannelList } from '../shared/common'

export function ActionsPanel({ detail, onPipelineCreated }: { detail: AnalysisDetail; onPipelineCreated: () => void }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const suggested = detail.gauge?.supportSuggested === true
  return (
    <Panel title={t('analysis.actions.title')} data-testid="analysis-actions">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="brand" data-testid="create-pipeline" disabled={detail.status !== 'done'} onClick={() => setCreateOpen(true)}>
          {t('analysis.actions.create')}
        </Button>
        <Button variant={suggested ? 'secondary' : 'outline'} data-testid="contact-support" onClick={() => setSupportOpen(true)}>
          {t('analysis.actions.support')}
        </Button>
        {detail.createdPipelineId !== null && <span className="text-[12px] text-fg-3">{t('analysis.actions.created')}</span>}
      </div>
      {suggested && <p className="mt-3 text-[12.5px] text-warn">{t('analysis.actions.supportSuggested')}</p>}
      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} analysisId={detail.id} onCreated={onPipelineCreated} />
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} analysisId={detail.id} />
    </Panel>
  )
}

function CreateDialog({ open, onOpenChange, analysisId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; analysisId: number; onCreated: () => void }) {
  const { channels } = useChannelList()
  const [picked, setPicked] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const channelId = picked ?? channels[0]?.id ?? null
  const create = async () => {
    if (channelId === null) return
    setBusy(true)
    try {
      const res = await call('analysis.createPipeline', analysisId, channelId)
      toast.success(t('analysis.create.done', { name: res.pipeline.name, n: res.styleVersion }))
      onOpenChange(false)
      onCreated()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('analysis.common.close')}>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl leading-tight">{t('analysis.create.title')}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-3">{t('analysis.create.blurb')}</DialogDescription>
        </DialogHeader>
        {channels.length === 0 ? (
          <p className="text-[13px] text-fg-3">{t('analysis.create.noChannel')}</p>
        ) : (
          <Field label={t('analysis.create.channel')} htmlFor="create-channel">
            <Select id="create-channel" value={channelId ?? ''} onChange={(e) => setPicked(Number(e.target.value))}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('analysis.common.cancel')}
          </Button>
          <Button variant="brand" data-testid="create-pipeline-confirm" disabled={busy || channelId === null} onClick={() => void create()}>
            {busy ? t('analysis.create.busy') : t('analysis.create.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SupportDialog({ open, onOpenChange, analysisId }: { open: boolean; onOpenChange: (o: boolean) => void; analysisId: number }) {
  const [what, setWhat] = useState('')
  const [links, setLinks] = useState('')
  const [budget, setBudget] = useState('')
  const [contact, setContact] = useState('')
  const [attach, setAttach] = useState(true)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      await call('support.create', { what, links, budget, contact, attachAnalysis: attach, analysisId: attach ? analysisId : null })
      toast.success(t('analysis.support.done'))
      setWhat('')
      setLinks('')
      setBudget('')
      onOpenChange(false)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('analysis.common.close')} className="w-[min(560px,92vw)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl leading-tight">{t('analysis.support.title')}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-3">{t('analysis.support.blurb')}</DialogDescription>
        </DialogHeader>
        <DemoBoundary feature="support-email">
        <div className="grid gap-4">
        <Field label={t('analysis.support.what')} htmlFor="support-what">
          <Textarea id="support-what" rows={4} value={what} placeholder={t('analysis.support.whatPlaceholder')} onChange={(e) => setWhat(e.target.value)} />
        </Field>
        <Field label={t('analysis.support.links')} htmlFor="support-links">
          <Input id="support-links" value={links} onChange={(e) => setLinks(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('analysis.support.budget')} htmlFor="support-budget">
            <Input id="support-budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label={t('analysis.support.contact')} htmlFor="support-contact">
            <Input id="support-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 text-[12.5px] text-fg-2">
          <input type="checkbox" checked={attach} className="accent-[var(--brand)]" onChange={(e) => setAttach(e.target.checked)} />
          {t('analysis.support.attach')}
        </label>
        </div>
        </DemoBoundary>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('analysis.common.cancel')}
          </Button>
          <Button variant="brand" data-testid="support-send" disabled={busy || !what.trim()} onClick={() => void send()}>
            {busy ? t('analysis.common.saving') : t('analysis.support.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
