// Mes outils (section `outils`): the list of the user's own tools, the sheet of the selected one and the manifest import.
// All real: the backend stores tools, versions, secrets (by name) and test runs. The test console is a dry run.
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import type { ToolRow } from '../../../shared/tools'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { call, useLoader } from '@/state/client'
import type { ScreenProps } from '../registry'
import { ImportForm } from './ImportForm'
import { ToolList } from './ToolList'
import { ToolSheet } from './ToolSheet'

export function ToolsBody({ tools, selected, onSelect, onAdd, onDeleted }: { tools: readonly ToolRow[]; selected: string | null; onSelect: (slug: string) => void; onAdd: () => void; onDeleted: () => void }) {
  if (tools.length === 0) {
    return (
      <EmptyState
        title={t('tools.empty.title')}
        blurb={t('tools.empty.blurb')}
        action={
          <Button onClick={onAdd}>
            <Plus /> {t('tools.add')}
          </Button>
        }
      />
    )
  }
  const current = tools.find((x) => x.slug === selected)?.slug ?? tools[0]!.slug
  return (
    <div className="grid min-h-0 gap-6 lg:grid-cols-[19rem_1fr]">
      <ToolList tools={tools} selected={current} onSelect={onSelect} />
      <ToolSheet key={current} slug={current} onDeleted={onDeleted} />
    </div>
  )
}

export function ToolsScreen(_props: ScreenProps) {
  const list = useLoader(() => call('tools.list'), 'tools-list', ['tools', 'example'])
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const add = (
    <Button onClick={() => setAdding(true)}>
      <Plus /> {t('tools.add')}
    </Button>
  )
  return (
    <PageShell section="outils" title={t('section.outils')} subtitle={t('tools.subtitle')} actions={add}>
      {list.error ? (
        <ErrorLine message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingBlock rows={4} />
      ) : (
        <ToolsBody tools={list.data} selected={selected} onSelect={setSelected} onAdd={() => setAdding(true)} onDeleted={() => setSelected(null)} />
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('tools.add')}</DialogTitle>
            <DialogDescription>{t('tools.import.hint')}</DialogDescription>
          </DialogHeader>
          {adding && (
            <ImportForm
              mode={{ kind: 'add' }}
              onCancel={() => setAdding(false)}
              onDone={(slug) => {
                setAdding(false)
                setSelected(slug)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
