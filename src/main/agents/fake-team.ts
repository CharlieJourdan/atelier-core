// Deterministic stand-in for the whole team (ATELIER_FAKE_LLM=1, e2e only): chat turns echo Charlie's last line,
// "make a video about X for <channel>" calls create_video like the Supervisor would, "demande au <agent> : <q>"
// hands the question over with ask_agent, a handed-over question gets a short answer, and task runs write a short
// deliverable; the production engine's own roles answer through fake-engine.ts; the planner's steps use the real
// production tools through fake-team-steps.ts. Never calls a model.
import type { FakeReply } from '../llm/fake'
import { fakeEngineReply } from './fake-engine'
import { fakePlannedStepReply } from './fake-team-steps'
import type { CompletionRequest } from '../llm/types'

const MAKE_VIDEO = /make a video about (.+?) for (.+?)[.!?]*$/i
const ASK = /^demande (?:au |à la |à l’|à l'|à )(.+?)\s*:\s*(.+)$/i
const HANDED = /handed you this: (.+)\n\n[^\n]*:$/

export function fakeTeamReply(req: CompletionRequest): FakeReply {
  const engine = fakeEngineReply(req)
  if (engine) return engine
  const style = fakeStyleReply(req)
  if (style) return style
  const pipeline = fakePipelineReply(req)
  if (pipeline) return pipeline
  const inProduction = fakeInProductionReply(req)
  if (inProduction) return inProduction
  const planned = fakePlannedStepReply(req)
  if (planned) return planned
  const task = /^Make the (.+?) for the video "(.*?)"/.exec(req.prompt)
  if (task) {
    const [, what, video] = task
    return { text: `# ${what}: ${video}\n\nFake ${what?.toLowerCase()} written by the test team.`, chunkSize: 40 }
  }
  const name = /^You are the (.+?) of Atelier/.exec(req.system ?? '')?.[1] ?? 'Agent'
  const handed = HANDED.exec(req.prompt)
  if (handed) return { text: `${name} : réponse à « ${(handed[1] ?? '').trim()} ».`, chunkSize: 6 }
  const lastLine = req.prompt.split('\n\n').filter((p) => p.startsWith('Charlie:')).pop() ?? ''
  const text = lastLine.replace(/^Charlie:\s*/, '').split('\n')[0] ?? ''
  const make = MAKE_VIDEO.exec(text.trim())
  if (make && req.tools?.specs.some((s) => s.name === 'create_video')) {
    const topic = (make[1] ?? '').trim()
    const channel = (make[2] ?? '').trim()
    const title = topic.replace(/^./, (c) => c.toUpperCase())
    return {
      text: `I proposed "${title}" for ${channel}. Confirm the card and the team starts with the research.`,
      chunkSize: 6,
      toolCalls: [{ name: 'create_video', args: { channel, title, brief: `A video about ${topic}.` } }]
    }
  }
  const ask = ASK.exec(text.trim())
  if (ask && req.tools?.specs.some((s) => s.name === 'ask_agent')) {
    return {
      text: `J’ai demandé à ${(ask[1] ?? '').trim()} : sa réponse est au-dessus.`,
      chunkSize: 6,
      toolCalls: [{ name: 'ask_agent', args: { agent: (ask[1] ?? '').trim(), question: (ask[2] ?? '').trim() } }]
    }
  }
  return { text: `Fake reply to: ${text}`, chunkSize: 6 }
}

/** « Regarde si j'ai des vidéos en cours de production »: Atlas reads `production.list` and answers with it. */
export function fakeInProductionReply(req: CompletionRequest): FakeReply | null {
  if (!req.tools?.specs.some((s) => s.name === 'production_list')) return null
  const message = /Message from [^\n]*:\n(.*)/.exec(req.prompt)?.[1] ?? ''
  if (!/en cours de production|in production/i.test(message)) return null
  return {
    text: '',
    chunkSize: 24,
    toolCalls: [{ name: 'production_list', args: {} }],
    afterTools: ([r]) => {
      const answer = `Voici ce qui est en production en ce moment :\n${r?.text ?? 'je n’ai pas pu lire la production.'}`
      return `${answer}\n\n\`\`\`atelier\n${JSON.stringify({ actions: [{ type: 'done', result: answer }] })}\n\`\`\``
    }
  }
}

/**
 * The pipeline agent (production-12): a proposal gets a short summary; « moins cher » in a pipeline's conversation proposes
 * eco pictures and fewer AI clips through the pipeline tools, anything else is answered without a change.
 */
function fakePipelineReply(req: CompletionRequest): FakeReply | null {
  const names = req.tools?.specs.map((s) => s.name) ?? []
  if (!names.includes('pipeline_propose')) return null
  if (req.tools?.specs.some((s) => JSON.stringify(s.inputSchema).includes('"variant"'))) {
    const block = { summary: 'Tes vidéos montrent peu le présentateur et beaucoup d’images IA : je garde ce mélange.', why: { faithful: 'Au plus près de tes vidéos.', cheap: 'Images éco et deux fois moins de clips.', premium: 'Les meilleurs moteurs pour les images et le présentateur.' } }
    return { text: '```atelier-proposal\n' + JSON.stringify(block) + '\n```', chunkSize: 40 }
  }
  const last = req.prompt.split('\n').filter((l) => l.startsWith('Owner:')).pop() ?? ''
  if (/moins cher/i.test(last)) {
    const ops = [
      { op: 'setOption', option: 'quality.images', value: 'eco' },
      { op: 'setOption', option: 'clipShare', value: 0.05 },
      { op: 'setMix', kind: 'clipAi', share: 0.05 }
    ]
    return { text: 'Je passe les images en éco et je garde 5 % de clips : c’est moins cher, un peu moins proche de tes vidéos.', chunkSize: 12, toolCalls: [{ name: 'pipeline_propose', args: { ops, note: 'Images éco, 5 % de clips' } }] }
  }
  return { text: 'Je n’ai rien changé : dis-moi par exemple « moins cher ».', chunkSize: 12 }
}

/** The style agent (production-15): the style in two sentences and the sample's narration, in its fenced block. */
function fakeStyleReply(req: CompletionRequest): FakeReply | null {
  if (!(req.system ?? '').includes('```atelier-style```')) return null
  const presenter = /presenter (\d+) %/.exec(req.prompt)?.[1]
  const words = /What the owner wants: (.*)/.exec(req.prompt)?.[1] ?? ''
  const noPresenter = (presenter !== undefined && presenter === '0') || /voix off|sans pr[ée]sentateur/i.test(words)
  const documentary = /base documentary@[12]/.test(req.prompt) || /documentaire|archives?/i.test(words)
  const block = {
    base: documentary ? 'documentary@2' : noPresenter ? 'voiceover@1' : 'avatar@1',
    summary: !noPresenter && !presenter ? 'Un présentateur IA explique et des images IA illustrent chaque phrase : la pipeline Avatar part de tes mots.' : !noPresenter ? `Un présentateur à l’écran environ ${presenter} % du temps, des images IA réalistes et des plans de quelques secondes : la pipeline Avatar garde ce rythme.` : 'Une voix off sur des images de banque et quelques images IA, des plans longs et des sous-titres : la pipeline Voix off garde ce style.',
    script: 'Presque tout le monde range sa cuisine à l’envers, et c’est pour ça que les placards débordent toujours. Voici la méthode des trois boîtes, que les grands-mères utilisaient déjà : elle libère un placard entier en dix minutes, sans rien acheter.'
  }
  return { text: '```atelier-style\n' + JSON.stringify(block) + '\n```', chunkSize: 40 }
}
