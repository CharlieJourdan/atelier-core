// Lot 13 on the renderer side: several agents writing at once (each stream with its author and tool steps), the
// handoff card with French names and its refusal reason, saved tool steps, the Stop button, the tool labels.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { t } from '../../src/shared/fr'
import { CardView } from '@/components/conversations/cards'
import { Composer } from '@/components/conversations/composer'
import { Thread } from '@/components/conversations/thread'
import { applyStreamEvent } from '@/components/conversations/use-thread'
import { toolLabel } from '@/components/conversations/tool-labels'
import { sampleRow } from '@/components/conversations/fixtures'

const actions = { approve: () => undefined, requestRevision: () => undefined, decideProposal: () => undefined, resumeTask: () => undefined }
const names: Record<string, string> = { scriptwriter: 'Scénariste', voiceover: 'Voix off' }
const author = (id: string | null) => ({ name: (id && names[id]) ?? 'Chef d’équipe', index: 2 })

describe('streams of a group round', () => {
  it('keeps one reply per stream with its author, text and tool steps, and drops it when done', () => {
    let s = applyStreamEvent([], { streamId: 'a-1', conversationId: 1, authorId: 'scriptwriter', delta: 'Le script ' })
    s = applyStreamEvent(s, { streamId: 'a-1', conversationId: 1, authorId: 'scriptwriter', tool: { id: 'ask_agent-1', name: 'ask_agent', state: 'running' } })
    s = applyStreamEvent(s, { streamId: 'a-2', conversationId: 1, authorId: 'voiceover', delta: 'La voix' })
    s = applyStreamEvent(s, { streamId: 'a-1', conversationId: 1, authorId: 'scriptwriter', tool: { id: 'ask_agent-1', name: 'ask_agent', state: 'done' } })
    s = applyStreamEvent(s, { streamId: 'a-1', conversationId: 1, delta: 'est prêt.' })
    expect(s).toEqual([
      {
        streamId: 'a-1',
        text: 'Le script est prêt.',
        authorId: 'scriptwriter',
        toolSteps: [{ id: 'ask_agent-1', label: 'A passé la main à un collègue', state: 'done' }]
      },
      { streamId: 'a-2', text: 'La voix', authorId: 'voiceover' }
    ])
    expect(applyStreamEvent(s, { streamId: 'a-1', conversationId: 1, done: true }).map((x) => x.streamId)).toEqual(['a-2'])
  })

  it('draws each reply being written under its own agent', () => {
    const html = renderToStaticMarkup(
      <Thread
        messages={[]}
        streaming={[
          { streamId: 'a-1', text: 'Le script avance.', authorId: 'scriptwriter' },
          { streamId: 'a-2', text: '', authorId: 'voiceover', toolSteps: [{ id: 'x', label: toolLabel('list_videos', 'running'), state: 'running' }] }
        ]}
        actions={actions}
        author={author}
      />
    )
    expect(html.match(/data-testid="chat-streaming"/g)).toHaveLength(2)
    expect(html.indexOf('Scénariste')).toBeLessThan(html.indexOf('Voix off'))
    expect(html).toContain('Lit les vidéos en cours…')
  })

  it('shows the tools saved with a message, folded', () => {
    const html = renderToStaticMarkup(
      <Thread
        messages={[sampleRow({ tools: [{ name: 'ask_agent', state: 'done' }, { name: 'list_runs', state: 'error' }] })]}
        streaming={null}
        actions={actions}
        author={author}
      />
    )
    expect(html).toContain('data-testid="tool-steps"')
    expect(html).toContain(t('thread.toolsMany', { n: 2 }))
  })
})

describe('handoff card, Stop and labels', () => {
  it('names the agents in French and shows why a handoff was refused', () => {
    const html = renderToStaticMarkup(
      <CardView
        card={{ type: 'handoff', from: 'supervisor', to: 'voiceover', ask: 'La voix est prête ?', state: 'refused', reason: 'Limite de 3 passages de main par message atteinte' }}
        actions={actions}
      />
    )
    expect(html).toContain('Superviseur passe la main à Voix off')
    expect(html).toContain('data-testid="handoff-reason"')
    expect(html).toContain('Limite de 3 passages de main par message atteinte')
  })

  it('offers Stop only while agents answer', () => {
    const idle = renderToStaticMarkup(<Composer onSend={async () => undefined} onStop={() => undefined} />)
    expect(idle).not.toContain('composer-stop')
    const busy = renderToStaticMarkup(<Composer onSend={async () => undefined} busy onStop={() => undefined} />)
    expect(busy).toContain('data-testid="composer-stop"')
    expect(busy).toContain(`aria-label="${t('chat.stop')}"`)
  })

  it('labels every Atelier tool in French, present while running and past once done', () => {
    expect(toolLabel('run_pipeline', 'running')).toBe('Prépare une production…')
    expect(toolLabel('run_pipeline', 'done')).toBe('A proposé une production')
    expect(toolLabel('run_pipeline', 'error')).toBe('Échec de l’outil run_pipeline')
    expect(toolLabel('make_edit', 'running')).toBe('Utilise make_edit…')
  })
})
