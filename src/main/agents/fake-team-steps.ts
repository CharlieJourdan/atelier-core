// The deterministic team's planned steps (ATELIER_FAKE_LLM=1 and tests, never a model): a step of the planner
// (orchestra/planner.ts) is worked like a channel lead would, with the real tools — the script step attaches a script to
// the video's project (`project_prepare`), the production step prepares and launches the project (`project_prepare`, then
// `project_run`, a demo run) — and asks Charlie first when the brief names one of his gates. Each reply ends with the
// action block of the runtime's protocol (orchestra/actions.ts).
import type { FakeReply } from '../llm/fake'
import type { CompletionRequest } from '../llm/types'

const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``

/** A script of about 120 words a voice can read (spoken forms, short sentences), for the fake team's script step. */
export function fakeScript(title: string): string {
  const s = [
    `Aujourd'hui, on parle de ${title.toLowerCase()}.`,
    'C’est un sujet simple, mais on se trompe souvent.',
    'D’abord, on regarde ce qu’il faut savoir avant de commencer.',
    'Ensuite, on voit les gestes, un par un, sans se presser.',
    'Chaque geste a une raison, et je vais te la donner.',
    'Il faut un peu de patience, et de bons outils.',
    'On vérifie deux fois, puis on passe à la suite.',
    'Si quelque chose bloque, on revient à l’étape d’avant.',
    'Avec un peu d’habitude, tout devient plus facile.',
    'Le plus important, c’est de rester prudent du début à la fin.',
    'À la fin, tu sauras le faire seul, et bien.',
    'Si la vidéo t’a aidé, abonne-toi pour la suite.'
  ]
  return [s.slice(0, 4).join(' '), s.slice(4, 8).join(' '), s.slice(8).join(' ')].join('\n\n')
}

/** A planned step of the planner, or null when the request is something else. */
export function fakePlannedStepReply(req: CompletionRequest): FakeReply | null {
  // the task's own brief line (the memory or a handover may quote other steps' briefs)
  const brief = /^Brief: (Planned step "([a-z]+)".*)$/m.exec(req.prompt)
  const step = brief?.[2]
  if (!brief || !step) return null
  const video = /Video #(\d+)\./.exec(brief[1] ?? '')?.[1]
  const title = /^Title: (.*)$/m.exec(req.prompt)?.[1] ?? step
  const gate = /with gate "([a-z]+)"/.exec(brief[1] ?? '')?.[1]
  const approved = req.prompt.includes('Charlie answered your question') || req.prompt.includes('Approved by the approval level')
  if (gate && !approved) {
    return { text: `À valider : ${step}.${block([{ type: 'ask_human', kind: 'validate', question: `Valider l’étape « ${step} » de « ${title} » ?`, options: ['Valider', 'Revoir'], gate }])}`, chunkSize: 40 }
  }
  const tools = req.tools?.specs.map((s) => s.name) ?? []
  const done = (result: string): string => `${result}${block([{ type: 'done', result }])}`
  if (step === 'script' && video && tools.includes('project_prepare')) {
    return {
      text: '',
      chunkSize: 40,
      toolCalls: [{ name: 'project_prepare', args: { video: Number(video), script: fakeScript(title) } }],
      afterTools: ([r]) => (r && !r.isError ? done(`Script écrit et joint à la vidéo #${video}.`) : `Le script n’a pas pu être joint : ${r?.text ?? '?'}`)
    }
  }
  if (step === 'production' && video && tools.includes('project_run')) {
    return {
      text: '',
      chunkSize: 40,
      toolCalls: [
        { name: 'project_prepare', args: { video: Number(video) } },
        { name: 'project_run', args: { video: Number(video), why: 'Le créneau approche : fabrication en démo.' } }
      ],
      afterTools: (results) => {
        const run = results[1]
        if (!run || run.isError) return `La fabrication n’a pas pu démarrer : ${run?.text ?? results[0]?.text ?? '?'}`
        return done(`Fabrication lancée pour la vidéo #${video} : ${run.text}`)
      }
    }
  }
  // a lead that states its topic without saving it: the planner saves it on the video (planner.adoptTopic)
  return { text: done(step === 'topic' ? `Sujet décidé : « Les bons gestes, ${title} ». Angle : trois erreurs vues chez les clients.` : `Étape ${step} faite pour « ${title} ».`), chunkSize: 40 }
}
