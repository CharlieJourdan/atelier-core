// « Nouvelle idée » and « Modifier l’idée » (real mode): a title, an angle and, for a new idea, the channel it is for.
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import type { Idea } from '@/proto/data-brain'
import type { ProtoChannel } from '@/proto/types'

const TITLE = 'font-sans text-[18px] leading-tight font-semibold tracking-[-0.018em]'

export function IdeaDialog({
  idea,
  channels,
  defaultChannelId,
  onClose,
  onSave
}: {
  /** The idea being edited; absent for a new one. */
  idea?: Idea
  channels: ProtoChannel[]
  defaultChannelId: string
  onClose: () => void
  onSave: (value: { channelId: string; title: string; angle: string }) => void
}) {
  const [channelId, setChannelId] = useState(idea?.channelId ?? defaultChannelId)
  const [title, setTitle] = useState(idea?.title ?? '')
  const [angle, setAngle] = useState(idea?.angle ?? '')
  const valid = title.trim().length > 0 && channelId !== ''
  const submit = (): void => {
    if (!valid) return
    onSave({ channelId, title: title.trim(), angle: angle.trim() })
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(480px,92vw)]" closeLabel={t('common.close')} data-testid="idea-dialog">
        <DialogHeader>
          <DialogTitle className={TITLE}>{idea ? t('brain.idea.dialog.edit') : t('brain.idea.dialog.new')}</DialogTitle>
          <DialogDescription>{t('brain.idea.dialog.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!idea && (
            <div className="space-y-1.5">
              <Label htmlFor="idea-channel">{t('brain.idea.field.channel')}</Label>
              <Select id="idea-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="idea-title">{t('brain.idea.field.title')}</Label>
            <Input id="idea-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('brain.idea.field.title.ph')} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idea-angle">{t('brain.idea.field.angle')}</Label>
            <Textarea id="idea-angle" rows={3} value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={t('brain.idea.field.angle.ph')} />
          </div>
        </div>
        <DialogFooter className="justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} onClick={submit} data-testid="idea-save">
            {t('brain.idea.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
