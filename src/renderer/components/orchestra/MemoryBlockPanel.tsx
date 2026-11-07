// « Mémoire de l'espace » (Réglages › Général) and « Mémoire de la chaîne » (Chaînes › Règles): the shared memory blocks the
// agents read before each task (src/main/orchestra/layers.ts). Plain text the owner edits; real mode only (IPC). Give it a
// `key` per block: an edit in progress belongs to one block.
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'

const MAX = 8000

export function MemoryBlockPanel({ scope, channelId }: { scope: 'workspace' | 'channel'; channelId?: number }) {
  const block = useLoader(
    () => (scope === 'channel' && channelId !== undefined ? call('orchestra.contextBlock', 'channel', channelId) : call('orchestra.contextBlock', 'workspace')),
    `${scope}-${channelId ?? ''}`,
    ['orchestra']
  )
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const title = t(scope === 'workspace' ? 'orch.mem.workspace' : 'orch.mem.channel')
  const value = text ?? block.data?.text ?? ''
  const save = (): void => {
    setBusy(true)
    call('orchestra.saveContextBlock', { scope, ...(scope === 'channel' ? { channelId } : {}), text: value })
      .then(() => {
        setText(null)
        block.reload()
        toast.success(t('orch.mem.saved'))
      }, (e: unknown) => toast.error(errText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <Panel title={title} data-testid={`memory-block-${scope}`}>
      <p className="mb-3 text-[12px] text-fg-3">{t(scope === 'workspace' ? 'orch.mem.workspace.hint' : 'orch.mem.channel.hint')}</p>
      {block.error ? (
        <ErrorLine message={block.error} onRetry={block.reload} />
      ) : !block.data ? (
        <LoadingBlock rows={3} />
      ) : (
        <>
          <Textarea aria-label={title} value={value} maxLength={MAX} onChange={(e) => setText(e.target.value)} className="min-h-[160px] resize-y bg-surface-2 font-mono text-[12.5px]" />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-fg-3">
            <span className="num">{t('orch.mem.count', { n: value.length })}</span>
            <span>
              {block.data.updatedAt ? t('orch.mem.updated', { when: new Date(block.data.updatedAt).toLocaleString('fr-FR'), source: block.data.source }) : t('orch.mem.never')}
            </span>
            {block.data.archived && <span>{t('orch.mem.archived')}</span>}
            <Button size="sm" className="ml-auto" disabled={busy || text === null} onClick={save}>
              {t('orch.mem.save')}
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}
