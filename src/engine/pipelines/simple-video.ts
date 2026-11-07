// The template pipeline of lot P4: one narrated video from a topic, wired as ENGINE-SPEC §15.6's port table (minus the
// stages that arrive later: script.check, footage, graphics, thumbnails, QC). Gates as R37.1: script, voice, edit plan
// and visuals are `review`, the package is `owner`. The voice comes from the channel style (`$style.voice`), so a
// change of voice reruns the voice and what depends on it, never the research or the script (R7.4).
import type { Pipeline } from '../pipeline-schema'

export function simpleVideoPipeline(minutes = 1): Pipeline {
  return {
    $schema: 'atelier.pipeline/1',
    id: 'simple-video',
    version: 1,
    name: 'Vidéo simple narrée',
    format: { kind: 'youtube_long', aspect: '16:9', minutes: { default: minutes, min: Math.min(1, minutes), max: 30 } },
    inputs: [{ id: 'topic', kind: 'text', required: true, label: 'Sujet ou titre' }],
    budget: { default: 'usage_max' },
    nodes: [
      { id: 'research', type: 'research.topic@1', in: { topic: '$inputs.topic' }, params: { language: '$style.language' } },
      { id: 'script', type: 'script.write@1', in: { brief: 'research.brief' }, params: { language: '$style.language' }, gate: 'review' },
      {
        id: 'voice',
        type: 'voice.tts@1',
        in: { script: 'script.text' },
        params: { voice: '$style.voice', language: '$style.language', pace: '$style.pace' },
        gate: 'review'
      },
      { id: 'beats', type: 'beats.split@1', in: { script: 'script.text', words: 'voice.words', outline: 'script.outline' } },
      {
        id: 'director',
        type: 'director.plan@1',
        in: { beats: 'beats.beats', words: 'voice.words', outline: 'script.outline', brief: 'research.brief' },
        params: { captionsPreset: '$style.captions' },
        gate: 'review',
        modes: { qualite_max: { videoShare: 0.4, maxVideoClips: 12, mix: { stock: 0.3, image: 0.7 } }, usage_max: { videoShare: 0 } }
      },
      { id: 'visuals', type: 'visuals.fulfil@1', in: { list: 'director.genlist', voice: 'voice.audio' }, gate: 'review' },
      { id: 'captions', type: 'captions.make@1', in: { words: 'voice.words', script: 'script.text', plan: 'director.plan' }, params: { preset: '$style.captions', burn: '$style.burn' } },
      { id: 'sound', type: 'sound.music@1', in: { voice: 'voice.audio', words: 'voice.words', beats: 'beats.beats', plan: 'director.plan' } },
      {
        id: 'render',
        type: 'render.assemble@1',
        in: { plan: 'director.plan', images: 'visuals.images', clips: 'visuals.clips', voice: 'voice.audio', music: 'sound.music', subs: 'captions.subs' },
        modes: { qualite_max: { crf: 18, preset: 'slow' }, usage_max: { crf: 21, preset: 'veryfast' } }
      },
      {
        id: 'package',
        type: 'package.youtube@1',
        in: {
          video: 'render.video',
          script: 'script.text',
          outline: 'script.outline',
          words: 'voice.words',
          subs: 'captions.subs',
          plan: 'director.plan',
          images: 'visuals.images',
          brief: 'research.brief'
        },
        params: { language: '$style.language' },
        gate: 'owner'
      }
    ]
  }
}

/** The style fields the template reads (a minimal `atelier.style/1` subset, ENGINE-SPEC §15.8). */
export const DEFAULT_SIMPLE_STYLE = { language: 'fr', voice: 'demo-claire', pace: 'natural', captions: 'highlight', burn: true } as const
