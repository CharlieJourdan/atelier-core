import { useState } from 'react'
import { CADENCES, type AgentRow, type Cadence, type MemoryRow } from '../../../shared/agents'
import { call, useApi } from '../../state/client'

export interface AgentListProps {
  agents: AgentRow[]
  /** Agent whose editor is open. */
  openId?: string | null
  onToggleOpen?: (id: string) => void
  onToggleEnabled?: (agent: AgentRow, enabled: boolean) => void
  onCadence?: (agent: AgentRow, cadence: Cadence) => void
  onSave?: (agent: AgentRow, instructions: string) => void
  onReset?: (agent: AgentRow) => void
  onForget?: (agent: AgentRow, memory: MemoryRow) => void
  memory?: MemoryRow[]
  errors?: Record<string, string>
}

export const toolsLabel = (a: AgentRow): string => [...a.tools, ...(a.webSearch ? ['web search'] : [])].join(', ')

/** Pure presentational list of agents. */
export function AgentList(props: AgentListProps) {
  const { agents, openId = null, memory = [], errors = {} } = props
  return (
    <div className="stack" data-testid="agents-panel">
      {agents.map((a) => (
        <div key={a.id} className="agent-row" data-testid={`agent-row-${a.id}`}>
          <div className="agent-row-head">
            <strong>{a.name}</strong>
            <span className="badge">{a.tier}</span>
            <span className="muted small">{a.cadence.replace(/_/g, ' ')}</span>
            <span className="muted small grow">{toolsLabel(a)}</span>
            <label className="small">
              <input
                type="checkbox"
                checked={a.enabled}
                aria-label={`Enable ${a.name}`}
                onChange={(e) => props.onToggleEnabled?.(a, e.target.checked)}
              />{' '}
              Enabled
            </label>
            <button type="button" className="button" aria-expanded={openId === a.id} onClick={() => props.onToggleOpen?.(a.id)}>
              {openId === a.id ? 'Close' : 'Edit'}
            </button>
          </div>
          {openId === a.id && <AgentEditor key={a.instructions} agent={a} memory={memory} props={props} />}
          {errors[a.id] && (
            <p className="error small" role="alert">
              {errors[a.id]}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function AgentEditor({ agent, memory, props }: { agent: AgentRow; memory: MemoryRow[]; props: AgentListProps }) {
  const [text, setText] = useState(agent.instructions)
  return (
    <div className="agent-editor">
      <label className="field">
        <span>Instructions</span>
        <textarea
          className="input"
          rows={8}
          aria-label={`Instructions for ${agent.name}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="chat-card-actions">
        <button
          type="button"
          className="button primary"
          disabled={text === agent.instructions}
          onClick={() => props.onSave?.(agent, text)}
        >
          Save
        </button>
        {agent.customized && (
          <button type="button" className="button" onClick={() => props.onReset?.(agent)}>
            Reset to default
          </button>
        )}
        <label className="small">
          Cadence{' '}
          <select
            className="select"
            value={agent.cadence}
            aria-label={`Cadence for ${agent.name}`}
            onChange={(e) => props.onCadence?.(agent, e.target.value as Cadence)}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <strong className="small">Memory</strong>
        {memory.length === 0 ? (
          <p className="muted small">No notes yet.</p>
        ) : (
          <ul className="agent-memory">
            {memory.map((m) => (
              <li key={m.id}>
                <span className="small">{m.content}</span>
                <button type="button" className="button" onClick={() => props.onForget?.(agent, m)}>
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function AgentsPanel() {
  const agents = useApi('agents.list', ['agents'])
  const [openId, setOpenId] = useState<string | null>(null)
  const [memory, setMemory] = useState<MemoryRow[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const loadMemory = (id: string): void => {
    call('agents.memory', id).then(setMemory, () => setMemory([]))
  }
  const guard = (id: string, p: Promise<unknown>): void => {
    setErrors((e) => ({ ...e, [id]: '' }))
    p.catch((err: unknown) => setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) })))
  }

  if (agents.error) return <p className="error">{agents.error}</p>
  if (!agents.data) return <p className="muted">Loading…</p>

  return (
    <AgentList
      agents={agents.data}
      openId={openId}
      memory={memory}
      errors={errors}
      onToggleOpen={(id) => {
        if (openId === id) return setOpenId(null)
        setOpenId(id)
        setMemory([])
        loadMemory(id)
      }}
      onToggleEnabled={(a, enabled) => guard(a.id, call('agents.update', a.id, { enabled }))}
      onCadence={(a, cadence) => guard(a.id, call('agents.update', a.id, { cadence }))}
      onSave={(a, instructions) => guard(a.id, call('agents.update', a.id, { instructions }))}
      onReset={(a) => guard(a.id, call('agents.reset', a.id))}
      onForget={(a, m) => guard(a.id, call('agents.forget', m.id).then(() => loadMemory(a.id)))}
    />
  )
}
