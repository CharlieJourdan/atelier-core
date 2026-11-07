// Mes outils › versions of a tool: the active one, one-click rollback, the line diff against the active version and the
// import of a new manifest version.
import { GitCompare, Plus, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { compareSemver, diffLines, type ToolDetail } from '../../../shared/tools'
import { fmtDate } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { call } from '@/state/client'
import { ImportForm } from './ImportForm'
import type { Act } from './SecretsPanel'

const LINE_TONE = { add: 'bg-ok/10 text-ok', del: 'bg-err/10 text-err', same: 'text-fg-3' } as const
const LINE_MARK = { add: '+ ', del: '- ', same: '  ' } as const

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after)
  if (!lines.some((l) => l.type !== 'same')) return <p className="text-[12.5px] text-fg-3">{t('tools.versions.noDiff')}</p>
  return (
    <pre data-testid="version-diff" className="max-h-72 overflow-auto rounded-field border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-[1.55]">
      {lines.map((l, i) => (
        <span key={i} data-line={l.type} className={`block whitespace-pre-wrap ${LINE_TONE[l.type]}`}>
          {LINE_MARK[l.type]}
          {l.text}
        </span>
      ))}
    </pre>
  )
}

export function VersionsPanel({ tool, act, onImported }: { tool: ToolDetail; act: Act; onImported: () => void }) {
  const [comparing, setComparing] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const versions = [...tool.versions].sort((a, b) => compareSemver(b.version, a.version))
  const active = versions.find((v) => v.active)
  const other = versions.find((v) => v.version === comparing)
  return (
    <Panel
      title={t('tools.versions.title')}
      action={
        <Button type="button" variant="secondary" size="sm" onClick={() => setImporting(true)}>
          <Plus /> {t('tools.versions.import')}
        </Button>
      }
    >
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" data-testid="tool-versions">
        {versions.map((v) => (
          <li key={v.version} className="flex items-center gap-3 py-2.5" data-version={v.version} data-active={v.active}>
            <span className="font-mono text-[13px] text-fg">v{v.version}</span>
            {v.active && <Badge variant="brand">{t('tools.versions.active')}</Badge>}
            <span className="text-[12px] text-fg-3">{fmtDate(v.createdAt, true)}</span>
            {!v.active && (
              <span className="ml-auto flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setComparing(comparing === v.version ? null : v.version)}>
                  <GitCompare /> {t('tools.versions.compare')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void act(() => call('tools.activateVersion', tool.slug, v.version), t('tools.versions.activated', { version: v.version }))}
                >
                  <RotateCcw /> {t('tools.versions.activate')}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {other && active && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[12px] text-fg-3">{t('tools.versions.diffHint', { from: other.version, to: active.version })}</p>
          <DiffView before={other.manifestText} after={active.manifestText} />
        </div>
      )}
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('tools.versions.import')}</DialogTitle>
            <DialogDescription>{t('tools.versions.importHint')}</DialogDescription>
          </DialogHeader>
          {importing && (
            <ImportForm
              mode={{ kind: 'version', slug: tool.slug }}
              onCancel={() => setImporting(false)}
              onDone={() => {
                setImporting(false)
                onImported()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
