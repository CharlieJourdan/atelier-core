// Runs P3 → P4 on a channel profile with the REAL bricks / presenters / voices services (fixture ports: no picture is
// made, no money). Used by the definition tests and the proof writer.
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Brief, Feasibility, StyleDefinition, Synthesis, VideoAnalysis } from '../../../../../shared/clone'
import { phaseContext } from '../../context'
import { fakeChannel } from '../../fakes/channels'
import { fakeServices } from '../../fakes/services'
import { deterministicSynthesis } from '../../fakes/synthesis'
import { runP3 } from '../../p3-feasibility'
import { runP4 } from '../../p4-definition'
import { CloneStore } from '../../store'
import { bricksService } from '../bricks'
import type { PresenterPicturesPort } from '../lookalike'
import { peopleServices, type CatalogueVoice } from '../people'
import { buildAnalyses, type ChannelProfile } from './build'

/** A small catalogue of premade (never cloned) voices for the fixtures. */
export const FIXTURE_VOICES: readonly CatalogueVoice[] = [
  { id: 'elevenlabs_nPczCjzI2devNBz1zQrb', name: 'Brian', languages: ['*'], descriptors: ['male', 'deep', 'narrator', 'documentary', 'middle-aged'] },
  { id: 'elevenlabs_JBFqnCBsd6RMkjVDRZzb', name: 'George', languages: ['*'], descriptors: ['male', 'warm', 'middle-aged', 'storyteller', 'calm'] },
  { id: 'elevenlabs_fixture_young', name: 'Young energetic narrator', languages: ['fr', 'en'], descriptors: ['male', 'young', 'energetic', 'bright'] },
  { id: 'elevenlabs_fixture_older', name: 'Older craftsman', languages: ['fr'], descriptors: ['male', 'older', 'sixties', 'warm', 'regional'] },
  { id: 'clone_9999999', name: 'Somebody\'s clone (must never be picked)', languages: ['*'], descriptors: ['male', 'young', 'energetic', 'calm', 'warm', 'deep'] }
]

/** Charlie's own clones (Marcel): the presenter look and the ai33 voice clone the docs name (voice-quality-2026-11.md:12). */
export const OWN_CLONES: Record<string, { presenter: string; voice: string }> = {
  'https://www.youtube.com/@MarcelArtisan': { presenter: 'own-presenter:marcel', voice: 'clone_2716753' }
}

export interface PictureLog { portraits: string[]; angles: number }

export function fixturePictures(log: PictureLog): PresenterPicturesPort {
  return {
    portrait: async (prompt, name) => { log.portraits.push(prompt); return `placeholder:${name}` },
    angles: async (_ref, angles) => { log.angles += angles.length; return angles.length }
  }
}

export interface DefinitionRun { analyses: VideoAnalysis[]; synthesis: Synthesis; brief: Brief; feasibility: Feasibility; definition: StyleDefinition; pictures: PictureLog }

export async function runDefinition(p: ChannelProfile, over: Partial<Brief> = {}): Promise<DefinitionRun> {
  const analyses = buildAnalyses(p)
  const { services } = fakeServices(fakeChannel('presenter-motion'))
  const pictures: PictureLog = { portraits: [], angles: 0 }
  const real = peopleServices({
    own: { presenter: async (url) => OWN_CLONES[url]?.presenter ?? null, voice: async (url) => OWN_CLONES[url]?.voice ?? null },
    pictures: fixturePictures(pictures),
    catalogue: FIXTURE_VOICES
  })
  const s = { ...services, bricks: bricksService(), ...real }
  const store = new CloneStore(mkdtempSync(path.join(os.tmpdir(), `clone-def-${p.id}-`)), 'c1')
  const ctx = phaseContext(store, s, 1)
  const brief: Brief = {
    schema: 'atelier.clone.brief/1', cloneId: 'c1', createdAt: 'now', intent: 'copy-channel', references: [{ url: p.url, kind: 'channel', axes: [] }],
    style: null, language: p.language, sourceLanguage: null, testBudgetUsd: 1, humanInputs: { face: false, voice: false, footage: false }, ownChannel: false, said: [], ...over
  }
  const synthesis: Synthesis = { schema: 'atelier.clone.synthesis/1', cloneId: 'c1', createdAt: 'now', ...deterministicSynthesis(analyses) }
  const feasibility = await runP3(ctx, brief, synthesis, analyses)
  const definition = await runP4(ctx, brief, synthesis, feasibility, analyses)
  return { analyses, synthesis, brief, feasibility, definition, pictures }
}
