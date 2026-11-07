// The calendar worked backwards (docs/AGENT-RUNTIME.md §26), in pure code: the weekly slots of a channel's goals as
// times, and the chain of steps that makes one video ready for its slot — topic → Charlie's approval of the topic →
// script → production → QC → thumbnail → publication kit — each with a deadline before the slot and a typical duration.
// planner.ts uses it to open steps, to tell how late a slot is, and to warn early.
import type { GoalGate, GoalSlot } from '../../shared/api/autopilot'
import type { Db } from '../db'

export type PlanStep = 'topic' | 'approval' | 'script' | 'production' | 'qc' | 'thumbnail' | 'kit'
export type SlotKind = GoalSlot['kind']

export interface StepDef {
  step: PlanStep
  /** The task kind (routing.ts gives its tier: `script` is the expensive turn, `qc_check` and the kit are cheap). */
  kind: string
  /** The gates this step asks Charlie about when the channel's approval level has them. */
  gates: readonly GoalGate[]
  /** Deadline, in hours before the slot (half for a Short). */
  beforeH: number
  /** Typical duration in hours (half for a Short), for « will the slot be made? ». */
  hours: number
  /** French name, in titles and warnings. */
  label: string
  /** What the lead does (English, the agents' language). */
  brief: string
}

const HOUR = 3_600_000

export const STEPS: readonly StepDef[] = [
  { step: 'topic', kind: 'topics', gates: [], beforeH: 96, hours: 1, label: 'sujet', brief: 'Pick the topic of this video (angle, title idea, sources) from the channel goals, its ideas and its competitors, never one the channel already made. Then SAVE it on the video: project_prepare with video, title (the video title) and idea (the angle and its beats, the sourced facts, the channel’s script patterns, at most 2000 characters): until then the video is only « Vidéo du … » and nothing can be produced.' },
  { step: 'approval', kind: 'approval', gates: ['topic'], beforeH: 84, hours: 12, label: 'validation du sujet', brief: 'Have the topic chosen for this video validated.' },
  { step: 'script', kind: 'script', gates: ['script'], beforeH: 72, hours: 2, label: 'script', brief: 'Write the script of this video following the channel’s script patterns (delegate to your scriptwriter if you have one), save it (script.save), then attach it to the video with project_prepare (video, scriptFile). When project_prepare says the pipeline writes the script itself, give it your outline instead: project_prepare with video, title and idea (hook, numbered beats, sourced facts, the channel’s patterns, at most 2000 characters): the pipeline’s writer follows the idea.' },
  { step: 'production', kind: 'production', gates: ['voice', 'video'], beforeH: 48, hours: 6, label: 'production', brief: 'Produce the video: project_prepare (video) gives its project on the channel pipeline, with its script, and quotes it; then project_run launches it, a demo run unless Charlie approved the real engine in this task. If its pipeline reads a script and none is attached, ask Charlie for it (ask_human kind input, a question about the script). Stay within the quote below.' },
  { step: 'qc', kind: 'qc_check', gates: [], beforeH: 36, hours: 1, label: 'contrôle qualité', brief: 'Check the produced video against its topic and the channel standards (topic, facts, sound, pictures, length; delegate to your quality eye, who watches it). If it is not publishable and the fix is in the topic, the script or the settings, remake it before finishing: project_prepare with video, fresh: true and the fixed title and idea (or script), then project_run (as the production step did). Finish with done only once the video you hand over passed; else say plainly what is wrong.' },
  { step: 'thumbnail', kind: 'packaging', gates: ['thumbnail'], beforeH: 24, hours: 1, label: 'miniature', brief: 'Make the thumbnail of this video and its title.' },
  { step: 'kit', kind: 'publish_package', gates: ['kit'], beforeH: 12, hours: 1, label: 'kit de publication', brief: 'Put the publication kit together (video, thumbnail, title, description, tags, chapters) so Charlie only has to publish it.' }
]

/** The title a planned video carries until the team saves its topic (planner.ts). */
export const slotTitle = (label: string): string => `Vidéo du ${label}`
/** True while a video's title is still its slot's placeholder: its topic was never saved. */
export const isSlotTitle = (title: string): boolean => /^Vidéo du (lun|mar|mer|jeu|ven|sam|dim|mon|tue|wed|thu|fri|sat|sun)/i.test(title.trim())

/**
 * The topic a finished topic (or script) step stated, when the lead did not save it (production-equipe): the first
 * « quoted » title of its result, else its first sentence; the idea is the result itself. Null when there is nothing.
 */
export function topicFromResult(result: string | null | undefined): { title: string; idea: string } | null {
  const text = (result ?? '').replace(/\s+/g, ' ').trim()
  if (text.length < 10) return null
  const quoted = /«\s*([^»]{6,150}?)\s*»/.exec(text)?.[1]
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text
  const title = (quoted ?? first.replace(/^(sujet( décidé| choisi)?|topic)[^:]*:\s*/i, '')).slice(0, 150).trim()
  if (!title || isSlotTitle(title)) return null
  return { title, idea: text.slice(0, 2000) }
}

export function stepDef(step: string): StepDef | undefined {
  return STEPS.find((s) => s.step === step)
}

const scale = (kind: SlotKind): number => (kind === 'short' ? 0.5 : 1)

export function deadlineOf(step: PlanStep, slotAt: number, kind: SlotKind): number {
  const d = stepDef(step) as StepDef
  return slotAt - d.beforeH * scale(kind) * HOUR
}

export function durationOf(step: PlanStep, kind: SlotKind): number {
  return (stepDef(step) as StepDef).hours * scale(kind) * HOUR
}

/** A slot's work opens a day before its topic is due: 5 days ahead (2,5 for a Short), so the subscription is spread. */
export const OPEN_AHEAD_H = 120

export function opensAt(slotAt: number, kind: SlotKind): number {
  return slotAt - OPEN_AHEAD_H * scale(kind) * HOUR
}

/** The earliest time `steps` can all be finished, starting at `from`. */
export function finishEstimate(steps: readonly StepDef[], from: number, kind: SlotKind): number {
  return steps.reduce((t, s) => t + durationOf(s.step, kind), from)
}

/** The times of the weekly slots in (from, to], in order (local time, or UTC in tests). */
export function slotTimes(slots: readonly GoalSlot[], from: number, to: number, utc: boolean): { at: number; kind: SlotKind }[] {
  const out: { at: number; kind: SlotKind }[] = []
  for (const s of slots) {
    const [h, m] = s.time.split(':').map(Number) as [number, number]
    const d = new Date(from)
    if (utc) d.setUTCHours(h, m, 0, 0)
    else d.setHours(h, m, 0, 0)
    for (let i = 0; i < 15; i++) {
      const isoDay = (((utc ? d.getUTCDay() : d.getDay()) + 6) % 7) + 1
      const at = d.getTime()
      if (isoDay === s.day && at > from && at <= to) out.push({ at, kind: s.kind })
      if (at > to) break
      if (utc) d.setUTCDate(d.getUTCDate() + 1)
      else d.setDate(d.getDate() + 1)
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** « jeu. 29 oct. 18:00 » */
export function slotLabel(at: number, utc: boolean): string {
  const d = new Date(at)
  const [day, date, month, h, m] = utc
    ? [d.getUTCDay(), d.getUTCDate(), d.getUTCMonth(), d.getUTCHours(), d.getUTCMinutes()]
    : [d.getDay(), d.getDate(), d.getMonth(), d.getHours(), d.getMinutes()]
  return `${DAYS[day]} ${date} ${MONTHS[month]} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The length the goals plan for a slot's video (production-equipe): the format of its kind, else null (the pipeline's
 * own default). Read by the planner's quote and the team's projects, so a 3-minute slot is never made at 12 minutes.
 */
export function plannedMinutes(db: Db, videoId: number): number | null {
  const r = db
    .prepare(`SELECT s.kind, g.formats_json FROM orch_plan_slots s JOIN channel_goals g ON g.channel_id = s.channel_id WHERE s.video_id = ?`)
    .get(videoId) as { kind: string; formats_json: string } | undefined
  if (!r) return null
  let formats: { kind?: unknown; minutes?: unknown }[] = []
  try {
    formats = JSON.parse(r.formats_json) as typeof formats
  } catch {
    return null
  }
  const m = formats.find((f) => f.kind === r.kind)?.minutes
  return typeof m === 'number' && m >= 0.5 && m <= 30 ? m : null
}
