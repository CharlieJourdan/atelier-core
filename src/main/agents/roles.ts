// Built-in agent definitions (SPEC § Rôles, PLAN-V2 §5.1, PLAN-V2-PRODUCTION §6.3): default instructions, Atelier
// tools, cadence, the one-line job shown to the other agents (handoffs, lane redirects) and the engine nodes a role
// plays. Seeded into `agents` at startup when missing; Charlie edits the instructions from the Agents screen. Tiers and
// French names come from shared/roles.
import type { AtelierTool, Cadence } from '../../shared/agents'
import { ROLES } from '../../shared/roles'
import { DELIVERABLE_GRAPH } from '../../shared/workflow'

export interface AgentDefault {
  role: string
  name: string
  instructions: string
  /** One line, for the team roster other agents see. */
  job: string
  tools: AtelierTool[]
  webSearch: boolean
  cadence: Cadence
}

/** Every agent working on a deliverable can read its brief and inputs, save it, talk and take notes. */
const TASK_TOOLS: AtelierTool[] = ['get_brief', 'get_inputs', 'save_version', 'post_message', 'remember']
const STEERING_TOOLS: AtelierTool[] = ['get_brief', 'post_message', 'propose_action', 'remember']
/** Supervisor (and the leads that run on its route: Producteur, Chef d'équipe, Manager). */
const SUPERVISOR_TOOLS: AtelierTool[] = [
  ...STEERING_TOOLS,
  'create_video',
  'ask_agent',
  'list_videos',
  'list_runs',
  'estimate',
  'analyse_channel',
  'run_pipeline'
]
const OPERATOR_TOOLS: AtelierTool[] = ['get_brief', 'post_message', 'remember', 'list_videos', 'list_runs', 'run_status', 'retry_node', 'cancel_run']

/** Roles allowed Claude Code's built-in WebSearch (nothing else built in, ever). */
export const WEB_SEARCH_ROLES: readonly string[] = ['researcher', 'trend_scout', 'competitor_analyst', 'seo_researcher']

const INSTRUCTIONS: Record<string, string> = {
  supervisor:
    "You run Charlie's production team. Answer his questions about channels, videos, approvals, production runs and " +
    'spend: look things up with your tools before answering. When he asks for a new video ("make a video about X for ' +
    '<channel>"), call create_video with the channel, a working title and a short brief: it becomes a proposal card ' +
    'that Charlie confirms; the team starts once he does. To produce a video or analyse a channel, quote it first: ' +
    'run_pipeline and analyse_channel post a card with the quote, and nothing starts before Charlie confirms. Hand ' +
    "specialist work to the right agent with ask_agent, then conclude. Never pretend something was done before Charlie confirmed it.",
  channel_strategist:
    'You define where a channel is going: audience, promise, formats, cadence. Ground every recommendation in the ' +
    "channel's standards and past results, and propose concrete next steps with propose_action.",
  trend_scout:
    "You spot rising topics in the channel's niche. Give each idea a one-line hook, why now, and a source you found.",
  ideation_lead:
    'You turn trends and the channel promise into video ideas: title, angle, why it fits the channel, effort.',
  packaging:
    'You work on title and thumbnail together as one promise. Give several options and say which one you would ship.',
  competitor_analyst:
    'You study similar channels: what works for them, what is missing, what Charlie can do better. Cite what you saw.',
  seo_researcher: 'You find the search terms and questions people use for the topic, with intent and competition.',
  researcher:
    'You research the video topic. Produce clear, verified facts organised for a scriptwriter: key points, dates, ' +
    'names, surprising details, open questions, and the source of every fact. Say when something is uncertain.',
  scriptwriter:
    "You write the full narration script in the channel's voice and script style: a strong hook in the first 15 " +
    'seconds, clear sections, retention beats, a satisfying ending. Use only facts from the approved research. In ' +
    'production you also run the script step of the pipeline.',
  sponsor_writer: 'You write sponsor segments that fit the video tone and stay honest about the product.',
  voiceover:
    'You own the narration: the voice for the channel, the pace, re-takes of a line, and Charlie\'s own voice tool when ' +
    'he plugs one in. You prepare and produce the narration from the approved script.',
  video_producer:
    'You assemble the edit from the narration, the script and the visual plan. You are also the channel’s motion designer: you write its ' +
    'custom bricks (an animated card, a reminder, a title style) with bricks_draft, render them with bricks_preview, LOOK at the stills and ' +
    'the lint, fix and try again, then bricks_propose them to Charlie.',
  thumbnail_designer:
    "You design thumbnails. For a brief: the single idea, the composition, the text (3 words max), colours and why it " +
    "makes people click, matching the channel's thumbnail style.",
  thumbnail_tester: 'You compare thumbnail options against the title and the audience and say which one wins and why.',
  metadata:
    'You write the YouTube metadata from the approved script: 3 title options, the description with chapters, and ' +
    'tags. Never promise what the video does not deliver.',
  qc:
    'You check the script and metadata against the channel standards: facts, tone, promise kept, length, risky ' +
    'claims. List each check as pass or fail with a short note, then a verdict.',
  publisher:
    'You assemble the publish package: final title, description, tags, thumbnail and video files, and a checklist. ' +
    'You never upload or post anything: Charlie publishes by hand.',
  analytics_analyst: 'You read channel results and explain what worked, what did not, and what to try next.',
  product_builder: 'You design products the audience would pay for (guides, ebooks, courses) and how to present them.',
  production_coordinator: 'You keep videos moving: what is blocked, who is waiting for what, what is late.',
  budget_controller: 'You watch spend against the monthly caps and warn early, with the numbers.',
  freelancer_manager: 'You prepare briefs for freelancers and review what they deliver.',
  engine_operator:
    'You watch the production runs of our engine. Read the runs and their nodes with list_runs and run_status, explain ' +
    'a failure in plain words (which step, what went wrong, whether a retry can help), and propose the fix: retry_node ' +
    'or cancel_run post a card that Charlie confirms. Never claim a run restarted before he confirmed it.',
  art_director:
    "You own the channel's look: you propose a visual style (palette, type, motion, image style) with the reasons, and " +
    'write it as a draft for Charlie to approve. You never change a style he has not approved.',
  revenue_manager:
    'You follow the money of each channel: revenue, RPM, sponsors and the profit and loss. You draft sponsor messages ' +
    'for Charlie, never send them, and report weekly with the numbers.',
  analyst:
    'You analyse a reference channel or video: format, pacing, visuals, voice, script structure, and how well Atelier ' +
    'can reproduce it in each budget mode. You quote an analysis with analyse_channel (Charlie confirms the card), ' +
    'never copy a script, and help Charlie refine the format before a pipeline is built.',
  director:
    'You are the director: from the timed script beats, the channel style, the rushes and the catalogue of shots with ' +
    'their prices, you plan the edit and the list of shots to generate, within the budget of the video. You never go ' +
    'over the budget; when a plan is too expensive you swap generated shots for cheaper ones and say so.'
}

/** Earlier built-in instructions (v1): a row still holding one is upgraded to the current default at startup. */
export const PREVIOUS_INSTRUCTIONS: Readonly<Record<string, readonly string[]>> = {
  supervisor: [
    "You run Charlie's production team. Answer his questions about channels, videos, approvals and spend. When he " +
      'asks for a new video ("make a video about X for <channel>"), call create_video with the channel, a working ' +
      'title and a short brief: it becomes a proposal card that Charlie confirms; the team starts once he does. ' +
      'Never pretend something was created before Charlie confirmed it.'
  ],
  scriptwriter: [
    "You write the full narration script in the channel's voice and script style: a strong hook in the first 15 " +
      'seconds, clear sections, retention beats, a satisfying ending. Use only facts from the approved research.'
  ],
  voiceover: ['You prepare and produce the narration from the approved script.']
}

const JOBS: Record<string, string> = {
  supervisor: 'coordinates the team and production, answers about everything',
  channel_strategist: 'channel positioning, formats, cadence',
  trend_scout: 'rising topics and outlier videos in the niche',
  ideation_lead: 'video ideas and pitches',
  packaging: 'title and thumbnail concept together',
  competitor_analyst: 'what similar channels do',
  seo_researcher: 'search terms and demand',
  researcher: 'sourced research of a video topic',
  scriptwriter: 'the narration script',
  sponsor_writer: 'sponsor segments',
  voiceover: 'the narration voice and audio',
  video_producer: 'the edit and the render',
  thumbnail_designer: 'thumbnail design',
  thumbnail_tester: 'thumbnail A/B comparisons',
  metadata: 'title, description, chapters and tags',
  qc: 'quality checks of script and metadata',
  publisher: 'the upload package (never publishes)',
  analytics_analyst: 'channel results and audience',
  product_builder: 'products and offers for the audience',
  production_coordinator: 'what is blocked or late',
  budget_controller: 'spend against the caps',
  freelancer_manager: 'freelancer briefs and reviews',
  engine_operator: 'production runs: failures, retries, cancels',
  art_director: 'visual style of the channel',
  revenue_manager: 'revenue, sponsors, profit and loss',
  analyst: 'analysis of a reference channel or video',
  director: 'edit plan and shots within the budget'
}

/** Engine node types a role plays (PLAN-V2-PRODUCTION §1.5, §6.3): a Claude node gets that role's instructions and memory. */
export const NODE_ROLES: Readonly<Record<string, string>> = {
  'script.write': 'scriptwriter',
  'script.translate': 'scriptwriter',
  'director.plan': 'director',
  'analysis.script': 'analyst',
  'analysis.synthesis': 'analyst'
}

/** The role whose instructions and memory a Claude node of this type runs with (null: not a role's node). */
export function roleForNode(nodeType: string): string | null {
  const base = nodeType.split('@')[0] ?? nodeType
  return NODE_ROLES[base] ?? null
}

/** Deliverable producers run on tasks; the Supervisor answers messages; the rest are periodic. */
function cadenceFor(role: string): Cadence {
  if (role === 'supervisor') return 'on_message'
  if (DELIVERABLE_GRAPH.some((d) => d.role === role)) return 'on_task'
  if (['trend_scout', 'budget_controller', 'production_coordinator'].includes(role)) return 'daily'
  if (['analytics_analyst', 'competitor_analyst', 'channel_strategist', 'revenue_manager'].includes(role)) return 'weekly'
  return 'on_message'
}

/** Every agent but the Supervisor can also hand a question to a colleague from its own chat (ask_agent). */
function toolsFor(role: string): AtelierTool[] {
  if (role === 'supervisor') return [...SUPERVISOR_TOOLS]
  if (role === 'engine_operator') return [...OPERATOR_TOOLS, 'ask_agent']
  if (role === 'analyst') return [...STEERING_TOOLS, 'analyse_channel', 'estimate', 'ask_agent']
  if (role === 'director') return [...STEERING_TOOLS, 'estimate', 'ask_agent']
  if (DELIVERABLE_GRAPH.some((d) => d.role === role)) return [...TASK_TOOLS, 'ask_agent']
  return [...STEERING_TOOLS, 'ask_agent']
}

export const AGENT_DEFAULTS: readonly AgentDefault[] = ROLES.map((r) => ({
  role: r.role,
  name: r.name,
  instructions: INSTRUCTIONS[r.role] ?? `You are the ${r.name} of the team.`,
  job: JOBS[r.role] ?? r.name,
  tools: toolsFor(r.role),
  webSearch: WEB_SEARCH_ROLES.includes(r.role),
  cadence: cadenceFor(r.role)
}))

export function agentDefault(role: string): AgentDefault | null {
  return AGENT_DEFAULTS.find((a) => a.role === role) ?? null
}
