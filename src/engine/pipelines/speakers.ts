// Gives the voice node of a pipeline the characters' voices when the run's style has them (docs/ENGINE-SPEC.md §19.5):
// `speakers: '$style.speakers'` on every `voice.tts@1` node that does not set its own; likewise the channel voice's clones
// per engine (`voices: '$style.voices'`, decision 0029), and the channel's presenter to the presenter node
// (`presenter: '$style.presenter'`, production-7). The app uses it for every run (the template and the library pipelines),
// the demos for theirs. Returns the same document.
import type { Pipeline } from '../pipeline-schema'

export function withSpeakers(doc: Pipeline, style: Record<string, unknown>): Pipeline {
  for (const field of ['speakers', 'voices']) {
    if (typeof style[field] !== 'object' || style[field] === null) continue
    for (const n of doc.nodes) if (n.type === 'voice.tts@1' && !(n.params && field in n.params)) n.params = { ...(n.params ?? {}), [field]: `$style.${field}` }
  }
  if (typeof style.presenter === 'object' && style.presenter !== null) {
    for (const n of doc.nodes) if (n.type === 'avatar.speak@1' && !(n.params && 'presenter' in n.params)) n.params = { ...(n.params ?? {}), presenter: '$style.presenter' }
    // « le présentateur joue l'action » (production-8): the stills brick sends the presenter's portrait with the shots where someone acts
    for (const n of doc.nodes) {
      if (n.type === 'visuals.fulfil@1' && n.params?.people === 'presenter-as-actor' && !('presenter' in n.params)) n.params = { ...n.params, presenter: '$style.presenter' }
    }
  }
  return doc
}
