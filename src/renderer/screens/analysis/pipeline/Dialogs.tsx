// Dialogs of the Pipelines library: import a JSON document, create from a template, rename.
import { useRef, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { LibraryPipelineRow, PipelineProblem, TemplateInfo } from '../../../../shared/analysis'
import { Field } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'
import { ProblemList, useChannelList } from '../shared/common'

export function ImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; onImported: (row: LibraryPipelineRow) => void }) {
  const { channels } = useChannelList()
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<string>('')
  const [problems, setProblems] = useState<PipelineProblem[]>([])
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement | null>(null)

  const pick = async (f: File | undefined) => {
    if (!f) return
    try {
      setText(await f.text())
      setProblems([])
      if (!name) setName(f.name.replace(/\.json$/i, ''))
    } catch (err) {
      toast.error(errText(err))
    }
  }
  const run = async () => {
    setBusy(true)
    setProblems([])
    try {
      const res = await call('pipelines.import', text, { ...(name.trim() ? { name: name.trim() } : {}), channelId: channel === '' ? null : Number(channel) })
      if (res.ok) {
        toast.success(t('pipelines.import.done', { name: res.pipeline.name }))
        setText('')
        setName('')
        onOpenChange(false)
        onImported(res.pipeline)
      } else {
        setProblems(res.problems)
      }
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('analysis.common.close')} className="w-[min(640px,94vw)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl leading-tight">{t('pipelines.import.title')}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-3">{t('pipelines.import.blurb')}</DialogDescription>
        </DialogHeader>
        <Field label={t('pipelines.import.json')} htmlFor="import-json">
          <Textarea id="import-json" rows={9} className="font-mono text-[12px]" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={file} type="file" accept=".json,application/json" className="sr-only" aria-label={t('pipelines.import.file')} onChange={(e) => void pick(e.target.files?.[0])} />
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
            {t('pipelines.import.file')}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('pipelines.import.name')} htmlFor="import-name" hint={t('pipelines.import.nameHint')}>
            <Input id="import-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('pipelines.import.channel')} htmlFor="import-channel">
            <Select id="import-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">{t('pipelines.import.noChannel')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ProblemList problems={problems} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('analysis.common.cancel')}
          </Button>
          <Button variant="brand" data-testid="import-confirm" disabled={busy || !text.trim()} onClick={() => void run()}>
            {busy ? t('pipelines.import.busy') : t('pipelines.import.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TemplateDialog({ template, onClose, onCreated }: { template: TemplateInfo | null; onClose: () => void; onCreated: (row: LibraryPipelineRow) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!template) return
    setBusy(true)
    try {
      const row = await call('pipelines.createFromTemplate', template.id, name.trim() || template.name)
      toast.success(t('pipelines.template.done', { name: row.name }))
      setName('')
      onClose()
      onCreated(row)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={template !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('analysis.common.close')}>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl leading-tight">{t('pipelines.template.title')}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-3">{template ? `${template.name} · ${template.description}` : ''}</DialogDescription>
        </DialogHeader>
        <Field label={t('pipelines.template.name')} htmlFor="template-name">
          <Input id="template-name" value={name} placeholder={template?.name ?? ''} onChange={(e) => setName(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('analysis.common.cancel')}
          </Button>
          <Button variant="brand" data-testid="template-confirm" disabled={busy} onClick={() => void create()}>
            {t('pipelines.template.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RenameDialog({ row, onClose }: { row: LibraryPipelineRow | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [shown, setShown] = useState<number | null>(null)
  if (row && shown !== row.id) {
    setShown(row.id)
    setName(row.name)
    setDescription(row.description)
  }
  const save = async () => {
    if (!row) return
    try {
      await call('pipelines.rename', row.id, name, description)
      onClose()
    } catch (err) {
      toast.error(errText(err))
    }
  }
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('analysis.common.close')}>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl leading-tight">{t('pipelines.rename.title')}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-3">{t('pipelines.rename.blurb')}</DialogDescription>
        </DialogHeader>
        <Field label={t('pipelines.rename.name')} htmlFor="rename-name">
          <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('pipelines.rename.description')} htmlFor="rename-desc">
          <Textarea id="rename-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('analysis.common.cancel')}
          </Button>
          <Button variant="brand" data-testid="rename-confirm" disabled={!name.trim()} onClick={() => void save()}>
            {t('analysis.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
