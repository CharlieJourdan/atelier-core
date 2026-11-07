// Mes outils › the sheet of one tool: overview (manifest summary, activation, exposure to agents and production),
// permissions and secrets, test console and versions.
import { Trash2 } from 'lucide-react'
import { t } from '../../../shared/fr'
import type { ToolDetail } from '../../../shared/tools'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, LoadingBlock } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import { StatusChip, kindLabel } from './common'
import { PermissionsPanel, SecretsPanel, type Act } from './SecretsPanel'
import { TestConsole } from './TestConsole'
import { VersionsPanel } from './VersionsPanel'

function entryText(tool: ToolDetail): string {
  const e = tool.manifest.entry
  if (tool.manifest.kind === 'http') return `${e.method} ${e.url ?? ''}`
  if (tool.manifest.kind === 'mcp' && e.transport === 'http') return `MCP · ${e.url ?? ''}${e.tool ? ` · ${e.tool}` : ''}`
  const line = [e.command ?? '', ...e.args].join(' ').trim()
  return tool.manifest.kind === 'mcp' ? `MCP · ${line}${e.tool ? ` · ${e.tool}` : ''}` : line
}

export function PortList({ title, items }: { title: string; items: { name: string; type: string; description?: string }[] }) {
  return (
    <div>
      <h4 className="micro-label mb-1.5">{title}</h4>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-fg-3">{t('tools.sheet.nothing')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-fg-2">
          {items.map((i) => (
            <li key={i.name}>
              <code className="font-mono text-fg">{i.name}</code> <span className="text-fg-3">({i.type})</span>
              {i.description ? ` — ${i.description}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AgentsExposure({ tool, agents, act }: { tool: ToolDetail; agents: { id: string; name: string }[]; act: Act }) {
  const granted = new Set(tool.grantedAgents)
  const toggle = (id: string, on: boolean): void => {
    const next = new Set(granted)
    if (on) next.add(id)
    else next.delete(id)
    void act(() => call('tools.setAgents', tool.slug, [...next]))
  }
  return (
    <div>
      <h4 className="micro-label mb-1.5">{t('tools.expose.agents')}</h4>
      <p className="mb-2 text-[12px] text-fg-3">{t('tools.expose.agentsHint')}</p>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1.5 p-0 md:grid-cols-3" data-testid="tool-agents">
        {agents.map((a) => (
          <li key={a.id}>
            <label className="flex items-center gap-2 text-[13px] text-fg-2">
              <input type="checkbox" checked={granted.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} className="size-4 accent-[var(--brand)]" />
              {a.name}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function OverviewPanel({ tool, agents, act }: { tool: ToolDetail; agents: { id: string; name: string }[]; act: Act }) {
  const m = tool.manifest
  const prod = m.expose.production
  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('tools.sheet.manifest')}>
        <div className="flex flex-col gap-4">
          {m.description && <p className="text-[13px] text-fg-2">{m.description}</p>}
          <dl className="m-0 grid grid-cols-[8rem_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-fg-3">{t('tools.sheet.id')}</dt>
            <dd className="m-0 font-mono text-fg-2">{tool.slug}</dd>
            <dt className="text-fg-3">{t('tools.sheet.kind')}</dt>
            <dd className="m-0 text-fg-2">{kindLabel(m.kind)}</dd>
            <dt className="text-fg-3">{t('tools.sheet.entry')}</dt>
            <dd className="m-0 font-mono text-[12px] break-all text-fg-2">{entryText(tool)}</dd>
          </dl>
          <div className="grid gap-4 md:grid-cols-2">
            <PortList title={t('tools.sheet.inputs')} items={m.inputs} />
            <PortList title={t('tools.sheet.outputs')} items={m.outputs} />
          </div>
          {tool.status === 'error' && tool.error && <ErrorLine message={tool.error} />}
        </div>
      </Panel>
      <Panel title={t('tools.expose.title')}>
        <div className="flex flex-col gap-5">
          <AgentsExposure tool={tool} agents={agents} act={act} />
          <div>
            <h4 className="micro-label mb-1.5">{t('tools.expose.production')}</h4>
            {prod ? (
              <p className="text-[13px] text-fg-2" data-testid="tool-production">
                {t('tools.expose.slot', { slot: t(`tools.slot.${prod.slot}` as never) })}
                {prod.ports.length > 0 && <span className="text-fg-3"> · {prod.ports.map((p) => `${p.name} (${p.direction === 'in' ? t('tools.expose.in') : t('tools.expose.out')})`).join(', ')}</span>}
              </p>
            ) : (
              <p className="text-[12.5px] text-fg-3">{t('tools.expose.noProduction')}</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  )
}

export function ToolSheet({ slug, onDeleted }: { slug: string; onDeleted: () => void }) {
  const detail = useLoader(() => call('tools.get', slug), `tool:${slug}`, ['tools'])
  const agents = useLoader(() => call('agents.list'), 'tool-agents', ['agents'])
  const confirm = useConfirm()

  const act: Act = async (run, success) => {
    try {
      await run()
      if (success) toast.success(success)
      return true
    } catch (err) {
      toast.error(errText(err))
      return false
    }
  }
  const remove = async (tool: ToolDetail): Promise<void> => {
    const ok = await confirm({ title: t('tools.delete.title'), description: t('tools.delete.body', { name: tool.name }), confirmLabel: t('tools.delete.confirm'), danger: true })
    if (!ok) return
    if (await act(() => call('tools.delete', tool.slug), t('tools.delete.done'))) onDeleted()
  }

  if (detail.error) return <ErrorLine message={detail.error} onRetry={detail.reload} />
  const tool = detail.data
  if (!tool) return <LoadingBlock rows={5} />
  const agentList = (agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="tool-sheet" data-tool={tool.slug}>
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-[26px] leading-tight text-fg">{tool.name}</h2>
        {tool.example && <ExampleBadge />}
        <span className="text-[12.5px] text-fg-3">v{tool.version}</span>
        <StatusChip status={tool.status} />
        <label className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-2">
          {t('tools.sheet.enabled')}
          <Switch
            checked={tool.status !== 'disabled'}
            aria-label={t('tools.sheet.enabled')}
            onCheckedChange={(v) => void act(() => call('tools.setEnabled', tool.slug, v), t(v ? 'tools.sheet.enabledDone' : 'tools.sheet.disabledDone'))}
          />
        </label>
        <Button type="button" variant="ghost" size="sm" className="text-err" onClick={() => void remove(tool)}>
          <Trash2 /> {t('tools.delete.confirm')}
        </Button>
      </header>
      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList className="self-start">
          <TabsTrigger value="overview">{t('tools.tab.overview')}</TabsTrigger>
          <TabsTrigger value="access">{t('tools.tab.access')}</TabsTrigger>
          <TabsTrigger value="test">{t('tools.tab.test')}</TabsTrigger>
          <TabsTrigger value="versions">{t('tools.tab.versions')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewPanel tool={tool} agents={agentList} act={act} />
        </TabsContent>
        <TabsContent value="access">
          <div className="flex flex-col gap-4">
            <PermissionsPanel tool={tool} act={act} />
            <SecretsPanel tool={tool} act={act} />
          </div>
        </TabsContent>
        <TabsContent value="test">
          <TestConsole tool={tool} />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsPanel tool={tool} act={act} onImported={detail.reload} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
