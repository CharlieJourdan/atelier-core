// The smaller tabs of a channel: automation, products and sponsors, rules, connections.
import { BarChart3, Folder, MessageCircle, Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CONNECTION_DETAIL, CONNECTION_IDS, CONNECTION_LABELS, type ConnectionId, type ConnectionState } from '@/proto/data-onboarding-channels'
import type { ChannelProduct, ProtoChannel } from '@/proto/types'
import { AUTOMATION_KEYS, AutomationMatrix, Inset, ProductsEditor, Row, Tag } from '../onboarding/parts'

export function AutomationTab({ channel, onChange }: { channel: ProtoChannel; onChange: (a: ProtoChannel['automation']) => void }) {
  const modes = AUTOMATION_KEYS.map((k) => channel.automation[k])
  const count = (m: 'auto' | 'validate' | 'human'): number => modes.filter((x) => x === m).length
  return (
    <div data-testid="automation-tab">
      <p className="mb-5 max-w-[620px] text-[13.5px] leading-[1.55] text-fg-3">{t('chan.auto.hint')}</p>
      <AutomationMatrix value={channel.automation} onChange={onChange} />
      <p className="mt-4 text-[13px] text-fg-3" data-testid="automation-summary">
        {t('chan.auto.summary', { auto: count('auto'), validate: count('validate'), human: count('human') })}
      </p>
    </div>
  )
}

export function ProductsTab({ channel, onChange }: { channel: ProtoChannel; onChange: (p: ChannelProduct[]) => void }) {
  return (
    <div data-testid="products-tab">
      <p className="mb-5 max-w-[620px] text-[13.5px] leading-[1.55] text-fg-3">{t('chan.products.hint')}</p>
      <ProductsEditor<ChannelProduct> items={channel.products} onChange={onChange} make={(p) => ({ kind: p.kind, name: p.name, ...(p.url ? { url: p.url } : {}) })} />
    </div>
  )
}

export function RulesTab({ rules, onChange }: { rules: string[]; onChange: (r: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    if (!draft.trim()) return
    onChange([...rules, draft.trim()])
    setDraft('')
  }
  return (
    <div data-testid="rules-tab">
      <p className="mb-5 max-w-[620px] text-[13.5px] leading-[1.55] text-fg-3">{t('chan.rules.hint')}</p>
      {rules.length > 0 && (
        <Inset className="mb-4">
          {rules.map((r, i) => (
            <div key={`${r}-${i}`} data-testid="rule-row" className="flex items-center gap-3 px-4 py-3">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fg-3" />
              <span className="min-w-0 flex-1 text-[14px] text-fg">{r}</span>
              <button
                type="button"
                aria-label={t('chan.rules.remove')}
                onClick={() => onChange(rules.filter((_, j) => j !== i))}
                className="rounded-full p-1.5 text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </Inset>
      )}
      <div className="flex items-center gap-2.5">
        <Input
          data-testid="rule-input"
          aria-label={t('chan.rules.add')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={t('chan.rules.placeholder')}
          className="h-10 max-w-[520px] flex-1 rounded-full px-4"
        />
        <button
          type="button"
          data-testid="rule-add"
          disabled={!draft.trim()}
          onClick={add}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface-3 px-4 text-[13px] font-medium text-fg outline-none hover:bg-selected focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden />
          {t('chan.rules.add')}
        </button>
      </div>
    </div>
  )
}

const CONNECTION_ICONS: Record<ConnectionId, typeof BarChart3> = { analytics: BarChart3, storage: Folder, publishing: Send, discord: MessageCircle }

export function ConnectionsTab({
  channel,
  connections,
  onConnection
}: {
  channel: ProtoChannel
  connections: Record<ConnectionId, ConnectionState>
  onConnection: (id: ConnectionId, on: boolean) => void
}) {
  return (
    <div data-testid="connections-tab">
      <p className="mb-5 max-w-[620px] text-[13.5px] leading-[1.55] text-fg-3">{t('chan.conn.hint')}</p>
      <Inset>
        {CONNECTION_IDS.map((id) => {
          const Icon = CONNECTION_ICONS[id]
          const on = id === 'analytics' ? channel.connected : connections[id] === 'on'
          const detail = CONNECTION_DETAIL[channel.id]?.[id]
          return (
            <Row
              key={id}
              testId={`connection-${id}`}
              label={
                <span className="flex items-center gap-2.5">
                  <Icon className="size-4 text-fg-3" aria-hidden />
                  {t(CONNECTION_LABELS[id].title)}
                  {on ? <Tag tone="ok">{t('chan.conn.on')}</Tag> : <Tag>{t('chan.conn.off')}</Tag>}
                </span>
              }
              hint={on && detail ? detail : t(CONNECTION_LABELS[id].hint)}
            >
              <button
                type="button"
                data-testid={`connection-toggle-${id}`}
                onClick={() => onConnection(id, !on)}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-[12.5px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-ring',
                  on ? 'border border-line-2 text-fg-2 hover:bg-hover' : 'bg-ink text-ink-fg hover:opacity-90'
                )}
              >
                {on ? t('chan.conn.disconnect') : t('chan.conn.connect')}
              </button>
            </Row>
          )
        })}
      </Inset>
    </div>
  )
}
