// The « technologies » of the agent runtime: every tool an agent may call, with the roles that get it by default. An
// agent's own list (orch_agents.technologies, editable on its sheet) replaces its role's defaults. Tools reach the model
// through the agents' MCP server (one `atelier` server per turn, the same bridge as the chat agents: src/main/agents/bridge.ts)
// and through `req.tools` for in-process providers (the FakeProvider in tests). Two technologies are not tools but
// rights on the action block (prompt.ts): `team.delegate` (the `delegate` action) and `inbox.ask` (`ask_human`).
// MCP tool names cannot hold a dot: `eyes.look` is offered as `eyes_look`.
import type { OrchTechnology } from '../../shared/api/orchestra'
import type { ToolSpec } from '../llm/types'
import { pipelineToolSpec, type PipelineToolName } from '../production/pipeline-agent/tools'
import { canonicalRole } from './roles'

type Group = OrchTechnology['group']

interface TechDef {
  id: string
  group: Group
  description: string
  spends?: boolean
  /** Not a tool: a right on the action block. */
  action?: boolean
  input: Record<string, unknown>
  required?: string[]
}

/** A pipeline tool (production-12) as a technology: the same schema as the pipeline's own agent, on a team pipeline by id. */
const pipelineDef = (id: string, tool: PipelineToolName): TechDef => {
  const spec = pipelineToolSpec(tool, 'pipeline')
  const schema = spec.inputSchema as { properties: Record<string, unknown>; required?: string[] }
  return { id, group: 'production', description: spec.description, input: schema.properties, ...(schema.required ? { required: schema.required } : {}) }
}

const S = (description: string): Record<string, unknown> => ({ type: 'string', description })
const I = (description: string): Record<string, unknown> => ({ type: 'integer', description })

const DEFS: readonly TechDef[] = [
  {
    id: 'eyes.look',
    group: 'eyes',
    description:
      'Look at a video: frames evenly spaced plus scene changes (JPEG files you can see), duration, fps, size, and the transcript ' +
      'when Atelier has one (its own runs keep word timings). Source: a local file path, a finished run id, or a team file. ' +
      'A YouTube link is analysed by Atelier Cloud only when its video analysis is on; otherwise you get its facts and thumbnail ' +
      'links only, and the answer says so. Use pass "quick" (6 small frames) unless you need detail.',
    input: {
      file: S('Absolute path of a local video file.'),
      run: I('Id of a finished production run: its final video (and its transcript).'),
      teamFile: S('Path of a team file, relative to the team folder.'),
      url: S('https link of a YouTube video.'),
      pass: { type: 'string', enum: ['quick', 'detailed'], description: 'quick: 6 frames at 384 px; detailed: up to 16 at 768 px.' },
      frames: I('How many frames (1..16, default by pass).')
    }
  },
  {
    id: 'channel.read',
    group: 'research',
    spends: true,
    description: "Read the public numbers of this channel and the competitors it watches (Atelier Cloud, YouTube Data API, read-only; one small job billed in credits).",
    input: { channel: I('Channel id (default: your channel).') }
  },
  {
    id: 'channel.outliers',
    group: 'research',
    description: 'The outlier videos among the latest reads of this channel and its competitors (views far above their usual), with why they worked. Free.',
    input: { channel: I('Channel id (default: your channel).'), limit: I('At most this many (default 10).') }
  },
  {
    id: 'ideas.list',
    group: 'research',
    description: 'Inspiration for topics: the strongest outliers of the watched competitors, title and why it worked. Free.',
    input: { channel: I('Channel id (default: your channel).'), limit: I('At most this many (default 5).') }
  },
  {
    id: 'style.profile',
    group: 'script',
    description: "The channel's style profile (hook, structure, pacing, tone, thumbnail traits) built by the eyes, or what the owner wrote. Free.",
    input: { channel: I('Channel id (default: your channel).') }
  },
  {
    id: 'script.brief',
    group: 'script',
    description:
      'Everything a script needs: the channel memory, its style profile and, to translate, the source script (from a finished run or a team file) and the target language. Free.',
    input: { run: I('Run whose script to translate.'), teamFile: S('Team file holding the source script.'), language: S('Target language (en, fr, es…).') }
  },
  {
    id: 'script.save',
    group: 'script',
    description:
      'Save a finished script as a team file. It is checked like the engine checks a narration (spoken forms, length, language) and the problems are returned. A production run can then use it.',
    input: { title: S('Short title.'), text: S('The complete narration.'), language: S('Its language (en, fr…).') },
    required: ['title', 'text']
  },
  {
    id: 'files.save',
    group: 'packaging',
    description: 'Save a short note or brief (Markdown) as a team file: a thumbnail concept, a QC report, a sponsor draft.',
    input: { name: S('File name, e.g. thumbnail-brief.md.'), text: S('Its content.') },
    required: ['name', 'text']
  },
  {
    id: 'thumbnail.brief',
    group: 'packaging',
    description: "What a thumbnail of this channel should look like: the style profile's thumbnail traits and the owner's notes. Free.",
    input: { channel: I('Channel id (default: your channel).') }
  },
  {
    id: 'production.quote',
    group: 'production',
    description: 'Quote a production run of a video in credits (nothing starts, nothing is spent).',
    input: { topic: S('Topic or title.'), minutes: { type: 'number', description: 'Length, 0.5..30.' }, pipeline: I('Library pipeline id (default: the engine template).') },
    required: ['topic']
  },
  {
    id: 'production.start',
    group: 'production',
    spends: true,
    description:
      'Start a production run for a new video of your channel, step by step: it stops at its first gate for Charlie. Only within the channel budget; the run holds its credits as usual.',
    input: {
      title: S('Title of the new video.'),
      topic: S('Topic given to the research node.'),
      minutes: { type: 'number', description: 'Length, 0.5..30 (default 8).' },
      pipeline: I('Library pipeline id (default: the engine template).'),
      scriptFile: S('Team file of a script to use when the pipeline takes one.'),
      real: { type: 'boolean', description: 'Real engine: the paid steps go through Atelier Cloud and spend real credits. Only once Charlie approved it in this task (ask_human first), or when your brief says the channel leaves the production to the team; default false = a demo run.' }
    },
    required: ['title', 'topic']
  },
  {
    id: 'project.prepare',
    group: 'production',
    description:
      "Give a planned video of your channel its production project on the channel's pipeline (it keeps the owner's imported script), save its topic (title and idea: the run's topic, which a pipeline that writes its own script follows), attach a script when its pipeline reads one, and quote it. Nothing starts, nothing is spent.",
    input: {
      video: I('Video id (the planned step says it).'),
      title: S('The video title (the topic chosen). Give it with idea.'),
      idea: S('The angle, the beats, the sourced facts and the channel script patterns (at most 2000 characters): the topic of the run.'),
      script: S('The script text to attach (when the pipeline reads one and none is attached).'),
      scriptFile: S('Team file of a saved script to attach instead (script.save gives it).'),
      pipeline: I('Pipeline id (default: the one the channel uses).'),
      fresh: { type: 'boolean', description: 'Remake: the video was made but refused (QC) or failed; a new project, same pipeline and length, to fix (topic, script) then run again.' }
    },
    required: ['video']
  },
  {
    id: 'project.run',
    group: 'production',
    spends: true,
    description:
      "Launch a prepared project: a demo run by default (nothing spent). real: true spends real credits through Atelier Cloud: only once Charlie approved it in this task (or the channel's level leaves the production to the team, said in your brief), and within the channel's monthly budget. The run stops at its gates for Charlie.",
    input: {
      project: I('Project id (project_prepare gives it).'),
      video: I('Or the video id: its project.'),
      real: { type: 'boolean', description: "Real engine (real credits). Default false = a demo run. Only after Charlie's yes in this task, or when your brief says the channel leaves the production to the team." },
      why: S('One sentence for the log.')
    }
  },
  {
    id: 'production.status',
    group: 'production',
    description: 'Production runs of your channel (state, the node waiting at a gate, credits) or one run in detail.',
    input: { run: I('One run id (default: the latest runs of your channel).') }
  },
  {
    id: 'production.list',
    group: 'production',
    description:
      'Videos in production now, read-only: the runs in progress (title, channel, state, the step running or the gate waiting for Charlie, progress) and the projects not finished yet. Free.',
    input: { channel: I('Only this channel (default: every channel you can see).'), all: { type: 'boolean', description: 'Also the finished, failed and cancelled runs of late.' } }
  },
  {
    id: 'production.approve',
    group: 'production',
    description: 'Approve the node a run waits on, ONLY when Charlie said so in his answer to you (it is refused otherwise).',
    input: { run: I('Run id.'), node: S('Node id waiting at its gate.') },
    required: ['run', 'node']
  },
  {
    id: 'production.cancel',
    group: 'production',
    description: 'Cancel a run of your channel (finished results stay, unspent credits are released).',
    input: { run: I('Run id.'), why: S('Why, in one sentence.') },
    required: ['run', 'why']
  },
  {
    id: 'qc.check',
    group: 'qc',
    description: 'Quality checks of a script text (spoken forms, length, language) or of a run (every node done, package complete). Returns pass / fail per check.',
    input: { run: I('Run id to check.'), text: S('A script to check.'), language: S('Expected language.') }
  },
  {
    id: 'dashboard.read',
    group: 'team',
    description: 'The dashboard: channels, the team (who works, who waits), tasks in the queue, runs in progress, what waits for Charlie, spend this month.',
    input: {}
  },
  {
    id: 'channel.create',
    group: 'team',
    description:
      'Create a channel (the same service as the app) with its team and its channel memory. ONLY after Charlie validated it through ask_human in this task; refused otherwise. Done once per task.',
    input: {
      name: S('Name of the new channel.'),
      niche: S('Its niche in a few words.'),
      language: S('Language of its videos (en, fr…).'),
      translateFrom: I('Id of the channel it translates, if any.'),
      audience: S('Who watches it.'),
      notes: S('Rules, tone, sponsors, competitors…: what the channel memory should start with.')
    },
    required: ['name']
  },
  {
    id: 'memory.workspace',
    group: 'memory',
    description: "Add a line to the workspace memory (who the owner is, goals, rules, tone): what every agent reads. Use it for lasting facts only.",
    input: { text: S('One short line.') },
    required: ['text']
  },
  {
    id: 'memory.channel',
    group: 'memory',
    description: "Add a line to your channel's memory (niche, audience, language, style, rules, sponsors, competitors): what every agent of the channel reads.",
    input: { text: S('One short line.'), channel: I('Channel id (default: your channel).') },
    required: ['text']
  },
  {
    id: 'goals.propose',
    group: 'team',
    description:
      "Propose your channel's standing goals to Charlie after analysing the channel and its competitors: publication slots, formats and lengths, " +
      'the monthly budget in credits, deadlines, and your reasons. Only while he has not confirmed them (they are a draft in your prompt until then); he confirms or edits them.',
    input: {
      slots: { type: 'array', description: 'Publication slots: {day: 1 (Monday)..7, time: "HH:MM", kind: "long"|"short"}.', items: { type: 'object' } },
      formats: { type: 'array', description: 'Formats: {kind: "long"|"short", minutes, perWeek}.', items: { type: 'object' } },
      budgetCredits: I('Monthly budget of paid generation in credits (1 credit = 0,01 €).'),
      deadlines: { type: 'array', description: 'Deadlines: {label, date: "YYYY-MM-DD"}.', items: { type: 'object' } },
      reasons: S('Why these numbers, in two or three sentences Charlie reads (competitors, your channel, the budget).')
    },
    required: ['reasons']
  },
  {
    id: 'bricks.draft',
    group: 'production',
    description:
      "Write (or rewrite) a custom brick of your channel: an animated overlay drawn by Atelier's headless browser in a sandbox (no network, no timers, a time budget per frame). " +
      'html: the markup (no <script>, <link>, <style>, no on…= handler, no web address); {{field}} is replaced by the field value, escaped. css: its style (data: URLs only; ' +
      "var(--accent), var(--fg), var(--panel), var(--f-<colour field>) and var(--safe-left|top|right|bottom) are set). script (optional, strict mode): set brick.render = function (t) {…} to draw frame t " +
      '(seconds from the overlay start); brick.values, brick.width, brick.height, brick.duration, brick.safe, brick.ease.out|inOut|back, brick.at(t, start, dur), brick.random() (seeded). ' +
      "Our runtime's presets also work on any element: data-anim=rise|fade|pop|left|right|wipe|grow data-at=<s> data-dur=<s> data-out=<s>, data-fit=<min px> (text shrinks to fit its box), data-count data-to=<n>. " +
      'Keep text inside the safe area (above the caption band), at least 24 px, on a backing or with a text-shadow. fields: text (max), number, color, image (data: URI only). ' +
      'sample: the values of the previews. use (to be placed in films): on start | end | person, seconds, bind {name, role} for person. Each change is a new version; then bricks_preview.',
    input: {
      id: S('Brick id: lowercase letters, digits, dashes (e.g. fiche-personnage).'),
      name: S('Its name for Charlie.'),
      description: S('What it is for, in one or two sentences.'),
      html: S('The markup.'),
      css: S('The style.'),
      script: S('Optional animation script (sets brick.render).'),
      fields: {
        type: 'array',
        description: 'Fields: {type:"text",name,max,default?,optional?} | {type:"number",name,min?,max?,default?} | {type:"color",name,default?} | {type:"image",name,optional?}.',
        items: { type: 'object' }
      },
      sample: { type: 'object', description: 'Sample values by field name (the previews use them).' },
      seconds: { type: 'object', description: 'How long it may stay on screen: {min, max} (default 2..8).' },
      use: { type: 'object', description: 'Where films place it: {on:"start"|"end"|"person", seconds, bind?:{name?, role?}, max?}. Absent: not placed in films.' }
    },
    required: ['id', 'name', 'html', 'fields', 'sample']
  },
  {
    id: 'bricks.preview',
    group: 'production',
    description:
      'Render your brick with its sample values in the sandbox: stills at 0 %, 50 % and 100 % (attached: LOOK at them), a short clip, the console errors and the lint ' +
      '(empty frames, text overflowing its box or the frame, text outside the safe area, text too small, contrast under 4.5:1 or no backing, network requests). ' +
      'At most 4 previews per round: fix what fails with bricks_draft, preview again, then bricks_propose.',
    input: {
      id: S('Brick id.'),
      aspect: { type: 'string', enum: ['16:9', '9:16'], description: 'Frame: 16:9 (default) or 9:16 (a short).' },
      values: { type: 'object', description: 'Values over the sample (e.g. a long name to test the fit).' },
      clip: { type: 'boolean', description: 'Also make the short clip (default true).' }
    },
    required: ['id']
  },
  {
    id: 'bricks.propose',
    group: 'production',
    description:
      "Propose your brick to Charlie once its last preview passed the lint and the stills look right: it goes to his inbox with the stills and your task waits for his answer. " +
      'Valider: the channel’s films can use it. Refuser: his note comes back to you; revise it (bricks_draft, bricks_preview) and propose again.',
    input: { id: S('Brick id.'), note: S('What you want Charlie to look at, in one or two sentences.') },
    required: ['id']
  },
  pipelineDef('pipeline.read', 'pipeline_read'),
  pipelineDef('pipeline.try', 'pipeline_try'),
  pipelineDef('pipeline.propose', 'pipeline_propose'),
  {
    id: 'style.study',
    group: 'production',
    spends: true,
    description:
      'Reproduce a style: the eyes measure 1 to 5 YouTube links (videos or channels; read-only, the first minutes of each video, billed ' +
      'in credits) and you get the closest pipelines built from the bricks (base, mix and curve, options, engines, styles), with price per ' +
      'minute and a free likeness estimate out of 100. A style, never a person: presenters and voices stay invented or the channel’s own.',
    input: { links: { type: 'array', items: { type: 'string' }, description: '1 to 5 YouTube video or channel links.' } },
    required: ['links']
  },
  { id: 'style.read', group: 'production', description: 'Read a style study: its proposals, its sample’s likeness score and the three biggest gaps with the edit that closes each. Free.', input: { study: I('Id of the style study.') }, required: ['study'] },
  {
    id: 'style.quote',
    group: 'production',
    description: 'Quote the short sample (15–20 s) of a study’s variant. Free; the sample itself runs only when the owner clicks « Lancer l’exemple » on this quote.',
    input: { study: I('Id of the style study.'), variant: { type: 'string', enum: ['faithful', 'cheap', 'premium'], description: 'The variant.' } },
    required: ['study', 'variant']
  },
  {
    id: 'videos.order',
    group: 'production',
    spends: true,
    description:
      "Charlie asks for videos made from HIS scripts (« lance-moi 3 vidéos, une par chaîne, avec ces scripts »): makes each one on its channel's pipeline with his script word for word, read from his own message (each script under a line naming its channel; a [PUB] marker in it is where the channel's promo goes). The code then makes, checks (blocking checks, edit review, blind judge), fixes a real error once and tells him in his inbox when each video is ready. Never rewrite or summarise his scripts. real: true (default) needs maxUsd, the most ONE video may cost (from his message, else ask him).",
    input: {
      real: { type: 'boolean', description: 'Real engine (real credits; default true). false = demo videos, nothing spent.' },
      maxUsd: { type: 'number', description: 'The most one video may cost, in dollars (required for a real order).' },
      items: {
        type: 'array',
        description: 'Only when his message does not put each script under its channel name: the channel id and the script copied EXACTLY from his message.',
        items: { type: 'object', properties: { channel: I('Channel id.'), script: S('The script, exactly as in his message.'), title: S('The title he gave, if any.') }, required: ['channel', 'script'] }
      }
    }
  },
  { id: 'videos.orders', group: 'production', description: "Where Charlie's ordered videos stand (made, checked, fixed, ready, failed and why).", input: { batch: S('One order only (videos_order gives it).') } },
  { id: 'team.delegate', group: 'team', action: true, description: 'Give tasks to the agents below you (the delegate action).', input: {} },
  { id: 'inbox.ask', group: 'team', action: true, description: 'Ask Charlie through his inbox (the ask_human action).', input: {} }
]

/** Default technologies per runtime role. A role not listed (custom agents) gets the base set. */
const ROLE_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  principal: ['team.delegate', 'inbox.ask', 'dashboard.read', 'production.list', 'channel.create', 'memory.workspace', 'memory.channel', 'videos.order', 'videos.orders'],
  channel_lead: ['team.delegate', 'inbox.ask', 'dashboard.read', 'production.list', 'memory.channel', 'style.profile', 'channel.outliers', 'production.status', 'goals.propose', 'project.prepare', 'project.run'],
  researcher: ['channel.outliers', 'ideas.list', 'channel.read', 'style.profile', 'inbox.ask'],
  competitor_analyst: ['eyes.look', 'channel.read', 'channel.outliers', 'ideas.list', 'memory.channel'],
  scriptwriter: ['script.brief', 'script.save', 'style.profile', 'qc.check'],
  production_supervisor: ['team.delegate', 'inbox.ask', 'production.quote', 'production.start', 'production.status', 'production.approve', 'production.cancel', 'project.prepare', 'project.run'],
  director: ['eyes.look', 'style.profile', 'production.status'],
  video_producer: ['production.status', 'eyes.look', 'bricks.draft', 'bricks.preview', 'bricks.propose'],
  packaging: ['thumbnail.brief', 'style.profile', 'files.save', 'production.status'],
  qc_eye: ['qc.check', 'eyes.look', 'production.status', 'files.save', 'inbox.ask'],
  publisher: ['production.status', 'files.save', 'inbox.ask'],
  sponsor_manager: ['files.save', 'inbox.ask'],
  pipeline_architect: ['production.quote', 'dashboard.read', 'inbox.ask', 'pipeline.read', 'pipeline.try', 'pipeline.propose', 'style.study', 'style.read', 'style.quote']
}
const BASE: readonly string[] = ['inbox.ask', 'files.save']

export const TECHNOLOGY_IDS: readonly string[] = DEFS.map((d) => d.id)
const BY_ID = new Map(DEFS.map((d) => [d.id, d]))

export const toolName = (id: string): string => id.replace(/\./g, '_')
export const technologyOfTool = (tool: string): string | null => DEFS.find((d) => toolName(d.id) === tool)?.id ?? null
export const isTechnology = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id)
export const isActionRight = (id: string): boolean => BY_ID.get(id)?.action === true
export const spends = (id: string): boolean => BY_ID.get(id)?.spends === true

export function roleTechnologies(role: string): string[] {
  return [...(ROLE_DEFAULTS[canonicalRole(role)] ?? BASE)]
}

/** The agent's list: its own (kept to known ids), else its role's defaults. */
export function technologiesOf(agent: { role: string; technologies: string[] | null }): string[] {
  return agent.technologies === null ? roleTechnologies(agent.role) : agent.technologies.filter(isTechnology)
}

/** Checks a list typed on the sheet or sent over IPC: known ids, no duplicates, at most every technology once. */
export function checkTechnologies(list: unknown): string[] {
  if (!Array.isArray(list)) throw new Error('technologies must be a list of technology ids')
  const out: string[] = []
  for (const id of list) {
    if (!isTechnology(id)) throw new Error(`Unknown technology: ${String(id)}`)
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** The MCP tool spec of a technology (null for an action right). */
export function toolSpec(id: string): ToolSpec | null {
  const d = BY_ID.get(id)
  if (!d || d.action) return null
  return {
    name: toolName(d.id),
    description: d.description,
    inputSchema: { type: 'object', properties: d.input, ...(d.required ? { required: d.required } : {}), additionalProperties: false }
  }
}

export function catalogue(): OrchTechnology[] {
  return DEFS.map((d) => ({
    id: d.id,
    tool: toolName(d.id),
    group: d.group,
    description: d.description,
    spends: d.spends === true,
    roles: Object.entries(ROLE_DEFAULTS)
      .filter(([, ids]) => ids.includes(d.id))
      .map(([r]) => r)
  }))
}

/** One line per technology for the system prompt (the model also gets the tools' schemas). */
export function technologyLines(ids: readonly string[]): string[] {
  return ids.map((id) => {
    const d = BY_ID.get(id)
    if (!d) return ''
    const name = d.action ? (id === 'team.delegate' ? 'action delegate' : 'action ask_human') : `tool ${toolName(id)}`
    return `- ${id} (${name}): ${d.description.split('. ')[0]}`
  }).filter(Boolean)
}
