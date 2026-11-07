import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fr, t, type MessageKey } from '../../src/shared/fr'
import { BLOCK_NAMES } from '../../src/shared/chat-rich'
import { buildFolders } from '../../src/shared/chat-folders'
import { CardView } from '@/components/conversations/cards'
import { RichBlock } from '@/components/conversations/blocks'
import { Composer } from '@/components/conversations/composer'
import { ConversationList } from '@/components/conversations/conversation-list'
import { Markdown, parseBlocks } from '@/components/conversations/markdown'
import { Body, Thread, ToolSteps } from '@/components/conversations/thread'
import { splitBody } from '../../src/shared/chat-rich'
import {
  CARD_SAMPLES,
  SAMPLE_THREAD,
  TOOL_STEPS_DONE,
  TOOL_STEPS_RUNNING,
  blockMessageBody
} from '@/components/conversations/fixtures'

const actions = { approve: () => undefined, requestRevision: () => undefined, decideProposal: () => undefined, resumeTask: () => undefined }
const author = (id: string | null) => ({ name: id ?? 'Superviseur', index: 1 })

describe('Markdown (Response)', () => {
  it('renders emphasis, code, lists, headings and mentions', () => {
    const html = renderToStaticMarkup(
      <Markdown text={'# Titre\n\nUn **gras**, un *italique*, du `code` et @Scénariste.\n\n- a\n- b\n\n1. un\n2. deux\n\n> cité\n\n```\nx = 1\n```'} />
    )
    expect(html).toContain('<strong>gras</strong>')
    expect(html).toContain('<em>italique</em>')
    expect(html).toContain('>code</code>')
    expect(html).toContain('data-testid="mention"')
    expect(html).toContain('<ul')
    expect(html).toContain('<ol')
    expect(html).toContain('<blockquote')
    expect(html).toContain('x = 1')
    expect(html).toContain('role="heading"')
  })

  it('never injects HTML and does not turn links into anchors', () => {
    const html = renderToStaticMarkup(<Markdown text={'<img src=x onerror=alert(1)> [clic](https://example.org)'} />)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<a ')
    expect(html).toContain('clic')
  })

  it('terminates on odd fence lines (no infinite loop)', () => {
    const texts = [
      '```npm run dev```',
      ['```c++', 'int x;'].join('\n'),
      ['```stats {"items":[]}', '```'].join('\n'),
      '```',
      ['a', '```', 'b'].join('\n')
    ]
    for (const text of texts) {
      expect(parseBlocks(text).length, text).toBeGreaterThan(0)
    }
  })

  it('tolerates half-streamed text (unclosed fence and emphasis)', () => {
    expect(() => renderToStaticMarkup(<Markdown text={'Du **gras en cou'} />)).not.toThrow()
    const blocks = parseBlocks('avant\n```js\nconst a')
    expect(blocks.at(-1)).toMatchObject({ t: 'code', text: 'const a' })
  })
})

describe('rich blocks', () => {
  it('draws each of the 10 blocks from its fixture', () => {
    for (const name of BLOCK_NAMES) {
      const seg = splitBody(blockMessageBody(name))[0]
      expect(seg?.kind, name).toBe('block')
      const html = renderToStaticMarkup(<RichBlock segment={seg as never} />)
      expect(html, name).toContain(`data-testid="block-${name}"`)
    }
  })

  it('draws a placeholder while a block is still streaming', () => {
    const html = renderToStaticMarkup(<Body text={'Voici\n```chart\n{"kind":"bar","ser'} final={false} />)
    expect(html).toContain('block-pending')
    expect(html).not.toContain('"kind"')
  })
})

describe('cards', () => {
  it('draws the 8 cards', () => {
    expect(CARD_SAMPLES.map((c) => c.type).sort()).toEqual(['approval', 'budget', 'engine', 'goal', 'handoff', 'proposal', 'qc', 'task'])
    for (const card of CARD_SAMPLES) {
      const html = renderToStaticMarkup(<CardView card={card} actions={actions} />)
      expect(html, card.type).toContain('data-testid="card-')
    }
  })

  it('offers Approve / Request changes only on an open approval', () => {
    const open = CARD_SAMPLES.find((c) => c.type === 'approval')
    if (open?.type !== 'approval') throw new Error('fixture')
    const html = renderToStaticMarkup(<CardView card={open} actions={actions} />)
    expect(html).toContain('Approuver')
    expect(html).toContain('Demander une correction')
    expect(html).toContain('À toi seul')
    const done = renderToStaticMarkup(<CardView card={{ ...open, status: 'approved' }} actions={actions} />)
    expect(done).not.toContain('Approuver')
    const stale = renderToStaticMarkup(<CardView card={{ ...open, stale: true }} actions={actions} />)
    expect(stale).not.toContain('Approuver')
    expect(stale).toContain('Remplacé')
  })
})

describe('tool steps', () => {
  it('folds finished steps into "✓ N outils" and shows a running one in Shimmering Text', () => {
    const done = renderToStaticMarkup(<ToolSteps steps={TOOL_STEPS_DONE} />)
    expect(done).toContain('✓ 3 outils')
    expect(done).toContain('data-folded="true"')
    expect(done).not.toContain('A lu la file du moteur')
    const running = renderToStaticMarkup(<ToolSteps steps={TOOL_STEPS_RUNNING} />)
    expect(running).toContain('data-folded="false"')
    expect(running).toContain('bg-clip-text')
    expect(running).toContain('Lit les statistiques de la chaîne…')
  })
})

describe('Thread', () => {
  it('groups consecutive messages of one agent and draws cards, system lines and attachments', () => {
    const html = renderToStaticMarkup(<Thread messages={SAMPLE_THREAD} streaming={null} actions={actions} author={author} />)
    // The 3 consecutive scriptwriter messages share one header; then voiceover, then qc after a system line.
    expect((html.match(/data-testid="chat-author"/g) ?? []).length).toBe(3)
    expect(html).toContain('data-author="system"')
    expect(html).toContain('brief.pdf')
    expect(html).toContain('card-handoff')
    expect(html).toContain('card-qc')
    expect(html).toContain('block-beats')
  })

  it('shows the empty state, and a streaming reply with its author', () => {
    const empty = renderToStaticMarkup(<Thread messages={[]} streaming={null} actions={actions} author={author} />)
    expect(empty).toContain(t('chat.empty.title'))
    const streaming = renderToStaticMarkup(<Thread messages={[]} streaming={{ streamId: 's', text: '' }} actions={actions} author={author} />)
    expect(streaming).toContain('data-testid="chat-streaming"')
    expect(streaming).toContain(t('chat.working'))
  })
})

describe('Composer and list', () => {
  it('draws the pill composer with attach and send', () => {
    const html = renderToStaticMarkup(<Composer onSend={() => Promise.resolve()} />)
    expect(html).toContain('data-testid="composer"')
    expect(html).toContain(`aria-label="${t('composer.attach')}"`)
    expect(html).toContain(`aria-label="${t('composer.send')}"`)
    expect(html).toContain('disabled')
  })

  it('draws the folder list', () => {
    const view = buildFolders({
      conversations: [{ id: 1, kind: 'supervisor', title: 'Superviseur', videoId: null, agentId: null, channelId: null, department: null, unread: 2, lastMessage: null, updatedAt: '' }],
      channels: [{ id: 1, name: 'Histoires' }],
      videos: [{ id: 5, channelId: 1, title: 'Ys' }],
      agents: [],
      rooms: [],
      channelId: 1,
      query: '',
      labels: { noMessage: '—', you: '', card: '', manager: '', room: () => '' }
    })
    const html = renderToStaticMarkup(
      <ConversationList channels={[{ id: 1, name: 'Histoires' }]} channelId={1} onChannel={() => undefined} query="" onQuery={() => undefined} view={view} selectedKey="c1" onSelect={() => undefined} />
    )
    expect(html).toContain('Histoires')
    expect(html).toContain('group-new')
    expect(html).toContain('group-videos')
    expect(html).toContain('group-team-production')
    expect(html).toContain('aria-current="true"')
  })
})

describe('French messages', () => {
  it('has a label for every dynamic status the cards can show', () => {
    const keys = Object.keys(fr) as MessageKey[]
    for (const k of ['card.status.waiting_approval', 'card.proposal.pending', 'card.engine.running', 'card.handoff.answered', 'block.stats', 'chat.dept.production'] as const) {
      expect(keys).toContain(k)
    }
  })
})
