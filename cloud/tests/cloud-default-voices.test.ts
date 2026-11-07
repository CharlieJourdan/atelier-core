// Issue #95: a brand-new channel has a real voice. The Cloud's voice catalogue lists a default REAL voice per language (ai33 Pro),
// and a demonstration voice is never sent to a real provider: the default voice of its language speaks instead.
import { describe, expect, it } from 'vitest'
import { DEFAULT_REAL_VOICES, defaultVoiceFor } from '../../src/shared/default-voices'
import { listVoices, realVoiceInput } from '../src/voices'
import { makeCloud } from './helpers'

describe('default real voices (issue #95)', () => {
  it('has a voice for French and English, maps the other languages, and falls back to English', () => {
    expect(defaultVoiceFor('fr').language).toBe('fr')
    expect(defaultVoiceFor('fr-FR').id).toBe(defaultVoiceFor('fr').id)
    expect(defaultVoiceFor('en').language).toBe('en')
    for (const l of ['es', 'de', 'it', 'pt']) expect(DEFAULT_REAL_VOICES.some((v) => v.language === l)).toBe(true)
    expect(defaultVoiceFor('ja').id).toBe(defaultVoiceFor('en').id)
    // no demonstration id among them
    expect(DEFAULT_REAL_VOICES.every((v) => !v.id.startsWith('demo-'))).toBe(true)
  })

  it('the catalogue lists each default real voice once, flagged default and not demo, after the demonstration voices', () => {
    const t = makeCloud()
    const voices = listVoices(t.cloud.db, 'no-team')
    const real = voices.filter((v) => !v.demo)
    expect(real.map((v) => [v.language, v.default])).toEqual([['fr', true], ['en', true]])
    expect(new Set(voices.map((v) => v.id)).size).toBe(voices.length)
    expect(voices.filter((v) => v.demo).every((v) => !v.default && v.id.startsWith('demo-'))).toBe(true)
  })

  it('a demo voice sent to a real provider becomes the default voice of its language; a real voice is left alone', () => {
    expect(realVoiceInput({ voiceId: 'demo-claire' })).toMatchObject({ voiceId: defaultVoiceFor('fr').id })
    expect(realVoiceInput({ voiceId: 'demo-hugo' })).toMatchObject({ voiceId: defaultVoiceFor('fr').id })
    expect(realVoiceInput({ voiceId: 'demo-ava' })).toMatchObject({ voiceId: defaultVoiceFor('en').id })
    expect(realVoiceInput({ voiceId: 'demo-ava' })?.note).toMatch(/remplacée par la voix par défaut/)
    expect(realVoiceInput({ voiceId: 'clone_2717589' })).toBeNull()
    expect(realVoiceInput({ voiceId: defaultVoiceFor('en').id })).toBeNull()
    expect(realVoiceInput({})).toBeNull()
  })
})
