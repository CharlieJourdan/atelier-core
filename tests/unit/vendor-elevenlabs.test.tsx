import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AudioPlayerButton,
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerProvider,
  AudioPlayerSpeed,
  AudioPlayerSpeedButtonGroup,
  AudioPlayerTime,
  LazyOrb,
  OrbFallback,
  ScrubBarContainer,
  ScrubBarProgress,
  ScrubBarThumb,
  ScrubBarTimeLabel,
  ScrubBarTrack,
  ShimmeringText,
  StaticWaveform,
  Waveform
} from '@/vendor/elevenlabs-ui'
import { AudioScrubber } from '@/vendor/elevenlabs-ui/waveform'

describe('vendored ElevenLabs UI components', () => {
  it('ShimmeringText renders its text with the shimmer classes', () => {
    const html = renderToStaticMarkup(<ShimmeringText text="Thinking about it" className="x-extra" />)
    expect(html).toContain('Thinking about it')
    expect(html).toContain('bg-clip-text')
    expect(html).toContain('x-extra')
    expect(html).toContain('--spread')
  })

  it('LazyOrb renders the CSS fallback built from the colors prop (no WebGL in Node)', () => {
    const html = renderToStaticMarkup(<LazyOrb colors={['#112233', '#445566']} className="orb-x" />)
    expect(html).toContain('data-slot="orb-fallback"')
    expect(html).toContain('#112233')
    expect(html).toContain('#445566')
    expect(html).toContain('orb-x')
  })

  it('OrbFallback has default colors', () => {
    expect(renderToStaticMarkup(<OrbFallback />)).toContain('#CADCFC')
  })

  it('ScrubBar pieces render track, progress, thumb and time labels', () => {
    const html = renderToStaticMarkup(
      <ScrubBarContainer duration={120} value={30}>
        <ScrubBarTimeLabel time={30} />
        <ScrubBarTrack>
          <ScrubBarProgress />
          <ScrubBarThumb />
        </ScrubBarTrack>
        <ScrubBarTimeLabel time={120} />
      </ScrubBarContainer>
    )
    expect(html).toContain('data-slot="scrub-bar-root"')
    expect(html).toContain('0:30')
    expect(html).toContain('2:00')
  })

  it('audio player renders its controls inside the provider', () => {
    const html = renderToStaticMarkup(
      <AudioPlayerProvider>
        <AudioPlayerButton />
        <AudioPlayerProgress />
        <AudioPlayerTime />
        <AudioPlayerDuration />
        <AudioPlayerSpeed />
        <AudioPlayerSpeedButtonGroup />
      </AudioPlayerProvider>
    )
    expect(html).toContain('<audio')
    expect(html).toContain('<button')
    expect(html).toContain('role="slider"')
    expect(html).toContain('0:00')
    expect(html).toContain('--:--')
    // aria labels in French (review A #12), none of the upstream English ones
    expect(html).toContain('aria-label="Vitesse de lecture"')
    expect(html).toContain('aria-label="Choix de la vitesse de lecture"')
    expect(html).toContain('aria-label="Lire"')
    expect(html).not.toMatch(/aria-label="(Play|Pause|Playback speed|Playback speed controls|Loading)"/)
    expect(html).toContain('1.5x')
  })

  it('Waveform and StaticWaveform render their container', () => {
    const wave = renderToStaticMarkup(<Waveform data={[0.2, 0.5, 0.9]} className="wave-x" />)
    expect(wave).toContain('wave-x')
    expect(wave).toContain('<canvas')
    const scrub = renderToStaticMarkup(<AudioScrubber data={[0.2, 0.5]} currentTime={1} duration={10} />)
    expect(scrub).toContain('aria-label="Forme d’onde, cliquer pour se déplacer"')
    const stat = renderToStaticMarkup(<StaticWaveform bars={12} className="static-x" />)
    expect(stat).toContain('static-x')
    expect(stat).toContain('<canvas')
  })
})
