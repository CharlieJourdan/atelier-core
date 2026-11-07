// Proto Planning: the schedule renders in plain Node (week and month views, stacks, render deadlines, the side sheet with
// the publication kit), follows the global scope, and its date / layout model is right.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fr } from '../../src/shared/fr'
import { enPPlanning } from '../../src/shared/en-p-planning'
import { frPPlanning } from '../../src/shared/fr-p-planning'
import { PLANNING_SCREENS } from '../../src/renderer/screens/planning'
import { SCREENS } from '../../src/renderer/screens/SectionScreen'
import { addDays, diffDays, fmtRange, fmtTime, minutesOf, monthGrid, startOfDay, startOfWeek, timeOf } from '../../src/renderer/screens/planning/dates'
import { MonthView } from '../../src/renderer/screens/planning/MonthView'
import { PlanningScreen } from '../../src/renderer/screens/planning/PlanningScreen'
import { groupItems, layoutDay, minutesAt, nowOffset, planItems, renderDeadlines, topOf, HOUR_H } from '../../src/renderer/screens/planning/planning-model'
import { VideoSheet } from '../../src/renderer/screens/planning/VideoSheet'
import { createProtoStore, initialState, ProtoProvider, useProtoActions, type ProtoState } from '../../src/renderer/proto/store'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'

const noop = (): void => undefined
const NOW = new Date(2026, 9, 24, 20, 30) // Saturday evening
const TODAY = startOfDay(NOW)
const count = (html: string, needle: string): number => html.split(needle).length - 1
const clean = (html: string): void => {
  for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
}

function renderIn(el: React.ReactElement, overrides: Partial<ProtoState> = {}): string {
  const store = createProtoStore(initialState(overrides))
  return renderToStaticMarkup(
    <ProtoProvider store={store}>
      <TooltipProvider>{el}</TooltipProvider>
    </ProtoProvider>
  )
}
const screen = (overrides: Partial<ProtoState> = {}): string => renderIn(<PlanningScreen route={{ section: 'planning' }} onRoute={noop} now={NOW} />, overrides)

describe('Planning screen', () => {
  it('is registered under planning and merged in the section screens', () => {
    expect(PLANNING_SCREENS.planning).toBe(PlanningScreen)
    expect(SCREENS.planning).toBe(PlanningScreen)
  })

  it('renders the toolbar: today, arrows, period label, week/month toggle, channel chips, legend', () => {
    const html = screen()
    expect(html).toContain('data-testid="view-planning"')
    expect(count(html, '<h1')).toBe(1)
    for (const id of ['planning-today', 'planning-prev', 'planning-next', 'planning-view-week', 'planning-view-month']) expect(html).toContain(`data-testid="${id}"`)
    expect(html).toContain('Aujourd’hui')
    expect(html).toContain('Semaine')
    expect(html).toContain('Mois')
    expect(count(html, 'data-testid="planning-chip-')).toBe(4)
    expect(html).toContain('Publication')
    expect(html).toContain('Rendu')
    expect(html).toMatch(/data-testid="planning-label"[^>]*>[^<]*2026/)
    clean(html)
  })

  it('shows seven day columns, today marked, a now line and the hour grid', () => {
    const html = screen()
    expect(count(html, 'data-testid="planning-day"')).toBe(7)
    expect(count(html, 'data-today="true"')).toBe(1)
    expect(html).toContain('data-testid="planning-now"')
    expect(html).toContain('9 h')
    expect(html).toContain('23 h')
  })

  it('draws events with channel, stage and progress, and gives one a stable test id', () => {
    const html = screen()
    expect(html).toContain('Le trésor des Templiers a-t-il vraiment existé ?')
    expect(html).toContain('data-testid="planning-event-first"')
    expect(count(html, 'data-testid="planning-event-first"')).toBe(1)
    expect(html).toContain('Les Grandes Énigmes · Montage')
    expect(html).toContain('role="progressbar"')
  })

  it('stacks the shorts of one channel and day into one card', () => {
    const html = screen()
    expect(html).toContain('3 shorts')
    expect(html).toContain('data-event="stack"')
    // today's three shorts are not drawn as three cards
    expect(html).not.toContain('Mon coloc a vendu mon chat pendant mes vacances')
  })

  it('shows render deadlines as dashed markers in the all-day row', () => {
    const html = screen()
    expect(html).toContain('data-testid="planning-render"')
    expect(html).toContain('border-dashed')
    expect(html).toContain('3 rendus')
  })

  it('follows the global scope and keeps the chips to the channels in scope', () => {
    const html = screen({ scope: 'ch-top' })
    expect(count(html, 'data-testid="planning-chip-')).toBe(1)
    expect(html).toContain('Les 10 animaux les plus rapides du monde')
    expect(html).not.toContain('Le trésor des Templiers')
    expect(html).not.toContain('3 shorts')
    clean(html)
  })
})

describe('planning model', () => {
  const state = initialState()

  it('turns day offsets into slots and drops unscheduled videos', () => {
    const items = planItems(state.videos, state.channels, 'all')
    expect(items.every((i) => i.video.publishInDays !== null)).toBe(true)
    expect(items.find((i) => i.video.id === 'v-test-avatar')).toBeUndefined()
    expect(planItems(state.videos, state.channels, 'ch-top')).toHaveLength(2)
    expect(planItems(state.videos, state.channels, 'all', ['ch-top']).some((i) => i.video.channelId === 'ch-top')).toBe(false)
  })

  it('groups same channel, same day, same format', () => {
    const groups = groupItems(planItems(state.videos, state.channels, 'all'))
    const today = groups.find((g) => g.channelId === 'ch-histoires' && g.dayOffset === 0)!
    expect(today.items).toHaveLength(3)
    expect(today.minutes).toBe(12 * 60)
    expect(today.format).toBe('short')
    const tomorrow = groups.find((g) => g.channelId === 'ch-histoires' && g.dayOffset === 1)!
    expect(tomorrow.items).toHaveLength(3)
    expect(groups.find((g) => g.items[0]?.video.id === 'v-templiers')?.items).toHaveLength(1)
  })

  it('lists render deadlines of videos not yet published, grouped per channel and day', () => {
    const d = renderDeadlines(state.videos, 'all', [], state.channels)
    const hv = d.find((x) => x.channelId === 'ch-histoires' && x.dayOffset === 0)!
    expect(hv.videos.map((v) => v.id).sort()).toEqual(['s-coloc', 's-heritage', 's-mariage'])
    expect(d.some((x) => x.videos.some((v) => v.stage === 'published'))).toBe(false)
  })

  it('shares the width of a day between overlapping events and positions them on the hour grid', () => {
    const groups = groupItems(planItems(state.videos, state.channels, 'all')).filter((g) => g.dayOffset === 3)
    const placed = layoutDay(groups)
    expect(placed.length).toBe(groups.length)
    const placedAll = layoutDay([
      { ...(groups[0] as (typeof groups)[0]), key: 'a', minutes: 15 * 60 },
      { ...(groups[0] as (typeof groups)[0]), key: 'b', minutes: 15 * 60 + 30 }
    ])
    expect(placedAll.map((p) => p.lane)).toEqual([0, 1])
    expect(placedAll.every((p) => p.lanes === 2)).toBe(true)
    expect(topOf(8 * 60)).toBe(0)
    expect(topOf(9 * 60)).toBe(HOUR_H)
  })

  it('snaps drops to 15 minutes inside the 8 h to 24 h window and places the now line', () => {
    expect(minutesAt(0)).toBe(8 * 60)
    expect(minutesAt(HOUR_H * 2 + 3)).toBe(10 * 60)
    expect(minutesAt(99_999)).toBe(23 * 60 + 45)
    expect(nowOffset(new Date(2026, 9, 24, 7, 0))).toBeNull()
    expect(nowOffset(new Date(2026, 9, 24, 12, 30))).toBe(4.5 * HOUR_H)
  })

  it('moving a video by drag updates its day and the grouping follows', () => {
    const store = createProtoStore(initialState())
    let actions!: ReturnType<typeof useProtoActions>
    function Grab(): null {
      actions = useProtoActions()
      return null
    }
    renderToStaticMarkup(
      <ProtoProvider store={store}>
        <Grab />
      </ProtoProvider>
    )
    actions.updateVideo('v-templiers', { publishInDays: 1, publishTime: '15:30' })
    const s = store.get()
    const g = groupItems(planItems(s.videos, s.channels, 'all')).find((x) => x.items.some((i) => i.video.id === 'v-templiers'))!
    expect(g.dayOffset).toBe(1)
    expect(g.minutes).toBe(15 * 60 + 30)
  })
})

describe('dates', () => {
  it('does Monday-first weeks and month grids', () => {
    expect(startOfWeek(NOW).getDay()).toBe(1)
    expect(diffDays(startOfWeek(NOW), TODAY)).toBe(5)
    const grid = monthGrid(new Date(2026, 9, 1))
    expect(grid.length % 7).toBe(0)
    expect(grid[0]?.getDay()).toBe(1)
    expect(grid.some((d) => d.getDate() === 31 && d.getMonth() === 9)).toBe(true)
  })

  it('counts calendar days across the daylight-saving change', () => {
    expect(diffDays(TODAY, addDays(TODAY, 1))).toBe(1)
    expect(diffDays(TODAY, addDays(TODAY, 10))).toBe(10)
    expect(diffDays(addDays(TODAY, 3), TODAY)).toBe(-3)
  })

  it('formats times and ranges', () => {
    expect(minutesOf('18:30')).toBe(18 * 60 + 30)
    expect(timeOf(18 * 60 + 5)).toBe('18:05')
    expect(fmtTime('18:00')).toBe('18 h')
    expect(fmtTime('12:30')).toBe('12 h 30')
    expect(fmtRange(TODAY, addDays(TODAY, 6))).toMatch(/oct\./)
  })
})

describe('month view', () => {
  const state = initialState()
  const groups = groupItems(planItems(state.videos, state.channels, 'all'))
  const deadlines = renderDeadlines(state.videos, 'all', [], state.channels)
  const html = renderIn(<MonthView anchor={new Date(2026, 9, 1)} today={TODAY} groups={groups} deadlines={deadlines} selectedId={null} onSelect={noop} onMove={noop} />)

  it('renders a grid of days with chips, at most three and a "+N"', () => {
    expect(html).toContain('data-testid="planning-month"')
    expect(count(html, 'data-testid="planning-cell"')).toBeGreaterThanOrEqual(35)
    expect(html).toContain('3 shorts')
    expect(html).toMatch(/\+\d+ de plus/)
    expect(html).toContain('data-today="true"')
    clean(html)
  })
})

describe('video sheet', () => {
  it('shows the stepper, progress, credits and an automatic publication without the kit', () => {
    const html = renderIn(<VideoSheet videoId="v-templiers" onClose={noop} onRoute={noop} />)
    expect(html).toContain('data-testid="planning-sheet"')
    expect(html).toContain('Le trésor des Templiers a-t-il vraiment existé ?')
    expect(count(html, 'data-state="done"')).toBe(5)
    expect(count(html, 'data-state="current"')).toBe(1)
    expect(count(html, 'data-state="todo"')).toBe(4)
    expect(html).toContain('72 %')
    expect(html).toContain('360 / 445')
    expect(html).toContain('Publication automatique')
    expect(html).not.toContain('data-testid="publication-kit"')
    expect(html).toContain('Afficher le kit de publication')
    expect(html).toContain('Ouvrir dans Production')
    clean(html)
  })

  it('shows the publication kit when the channel posts by hand', () => {
    const html = renderIn(<VideoSheet videoId="v-animaux" onClose={noop} onRoute={noop} />)
    expect(html).toContain('À poster à la main')
    expect(html).toContain('data-testid="publication-kit"')
    for (const b of ['Télécharger la vidéo', 'Télécharger la miniature', 'Copier le titre', 'Copier la description']) expect(html).toContain(b)
    // script stage: the video and the thumbnail do not exist yet
    expect(count(html, 'disabled=""')).toBe(2)
    clean(html)
  })

  it('shows every stage as done for a published video', () => {
    const html = renderIn(<VideoSheet videoId="v-roswell" onClose={noop} onRoute={noop} />)
    expect(count(html, 'data-state="done"')).toBe(10)
    expect(html).not.toContain('data-state="current"')
  })
})

describe('planning messages', () => {
  it('has no empty message and an English one for each key', () => {
    const keys = Object.keys(frPPlanning)
    expect(keys.length).toBeGreaterThanOrEqual(35)
    for (const k of keys) {
      expect((frPPlanning as Record<string, string>)[k], k).not.toBe('')
      expect((fr as Record<string, string>)[k], k).toBeDefined()
      expect((enPPlanning as Record<string, string>)[k], `en ${k}`).toBeTruthy()
    }
    expect(Object.keys(enPPlanning).every((k) => k in frPPlanning)).toBe(true)
  })
})
