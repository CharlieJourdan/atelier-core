// The Orb of an agent: the real WebGL Orb (vendored ElevenLabs UI) when `live`, otherwise the cheap CSS stand-in, so a
// grid of 27 agents never opens 27 WebGL contexts. Without a window (static render in plain Node) always the stand-in.
import { agentColors } from '@/components/atelier/primitives'
import { LazyOrb, OrbFallback } from '@/vendor/elevenlabs-ui'

export function AgentOrb({ index, live = false, thinking = false, size = 56 }: { index: number; live?: boolean; thinking?: boolean; size?: number }) {
  const [a, b] = agentColors(index)
  const colors: [string, string] = [a, b]
  return (
    <div data-slot="agent-orb" data-live={live && typeof window !== 'undefined' ? 'true' : 'false'} className="shrink-0" style={{ width: size, height: size }}>
      {live && typeof window !== 'undefined' ? <LazyOrb colors={colors} agentState={thinking ? 'thinking' : null} /> : <OrbFallback colors={colors} />}
    </div>
  )
}
