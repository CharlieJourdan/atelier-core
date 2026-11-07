// Réglages › Galerie, section "Conversations": every card, every rich block, tool steps, a streaming replay and the
// composer, drawn from fixtures. Nothing here talks to main, so it doubles as the proof screen of lot 12.
import { useEffect, useState } from 'react'
import { BLOCK_NAMES } from '../../shared/chat-rich'
import { CardView, type CardActions } from '@/components/conversations/cards'
import { Body, ToolSteps, useSmoothText } from '@/components/conversations/thread'
import { Composer } from '@/components/conversations/composer'
import { Thread } from '@/components/conversations/thread'
import {
  CARD_SAMPLES,
  SAMPLE_THREAD,
  TOOL_STEPS_DONE,
  TOOL_STEPS_RUNNING,
  blockMessageBody
} from '@/components/conversations/fixtures'
import { agentIndex } from '../../shared/chat-folders'
import type { MentionTarget } from '../../shared/chat-rich'
import { Button } from '@/components/ui/button'
import { t } from '../../shared/fr'

const noop = (): void => undefined
const ACTIONS: CardActions = { approve: noop, requestRevision: noop, decideProposal: noop, resumeTask: noop }

const TARGETS: MentionTarget[] = [
  ['scriptwriter', 'Scénariste'],
  ['voiceover', 'Voix_off'],
  ['researcher', 'Chercheur'],
  ['thumbnail_designer', 'Miniatures'],
  ['qc', 'Qualité'],
  ['supervisor', 'Superviseur']
].map(([id, name]) => ({ id: id as string, name: name as string, index: agentIndex(id as string), hint: id as string }))

const STREAM_TEXT =
  'Voici ma proposition : **trois actes**, une accroche de douze secondes, et des sources vérifiées.\n\n1. La légende\n2. Les fouilles\n3. La chute'

function StreamReplay() {
  const [run, setRun] = useState(0)
  const [raw, setRaw] = useState('')
  useEffect(() => {
    let i = 0
    const id = setInterval(() => {
      i = Math.min(STREAM_TEXT.length, i + 9)
      setRaw(STREAM_TEXT.slice(0, i))
      if (i >= STREAM_TEXT.length) clearInterval(id)
    }, 220)
    return () => clearInterval(id)
  }, [run])
  const shown = useSmoothText(raw, true)
  return (
    <div className="space-y-2" data-testid="gallery-stream">
      <div className="max-w-xl rounded-2xl bg-surface-2 px-4 py-2.5 text-[14px]">
        <Body text={shown} final={false} />
      </div>
      <Button size="sm" variant="secondary" onClick={() => {
          setRaw('')
          setRun((n) => n + 1)
        }}>
        {t('gallery.replay')}
      </Button>
    </div>
  )
}

export function ChatGallery() {
  return (
    <div className="space-y-6" data-testid="gallery-chat">
      <div className="grid gap-3 md:grid-cols-2">
        {CARD_SAMPLES.map((c) => (
          <CardView key={c.type} card={c} actions={ACTIONS} />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {BLOCK_NAMES.map((n) => (
          <div key={n} data-sample={n}>
            <Body text={blockMessageBody(n)} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <div data-testid="gallery-tools-running">
          <ToolSteps steps={TOOL_STEPS_RUNNING} />
        </div>
        <div data-testid="gallery-tools-done">
          <ToolSteps steps={TOOL_STEPS_DONE} />
        </div>
      </div>
      <StreamReplay />
      <div className="flex h-[520px] flex-col overflow-hidden rounded-card border border-line" data-testid="gallery-thread">
        <Thread
          messages={SAMPLE_THREAD}
          streaming={null}
          actions={ACTIONS}
          author={(id) => ({ name: id ? id.replace(/_/g, ' ') : t('chat.supervisor'), index: agentIndex(id) })}
        />
        <Composer mentions={TARGETS} onSend={() => Promise.resolve()} />
      </div>
    </div>
  )
}
