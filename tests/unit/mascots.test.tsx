// Agent mascots (decision 0057): every role has a character with a default accessory, the owner's colour and accessory
// choices are checked, stored on the agent and survive a restart, and the avatar draws the mascot (the coloured bubble
// stays the fallback). Static renders and the real core on a throwaway database; no model, no network.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createCore } from '../../src/main/core'
import { ACCESSORY_IDS, COMMON_ACCESSORIES, MASCOT_COLOR_COUNT, checkLook, parseLook } from '../../src/shared/mascot'
import { setLocale } from '../../src/shared/fr'
import { Mascot } from '../../src/renderer/components/mascot/Mascot'
import { MascotGallery } from '../../src/renderer/components/mascot/MascotGallery'
import { MascotEditor } from '../../src/renderer/components/mascot/MascotEditor'
import { ACCESSORIES } from '../../src/renderer/components/mascot/accessories'
import { resetLookStore, setLookOverride } from '../../src/renderer/components/mascot/look-store'
import { ROLE_LOOK, accessoryChoices, nextLook, resolveLook } from '../../src/renderer/components/mascot/roles'
import { AgentAvatar } from '../../src/renderer/components/proto/kit'
import { roleOf } from '../../src/renderer/proto/live/mapping'
import type { AgentRole } from '../../src/renderer/proto/types'
import { memoryCore, okTester, testCipher } from './helpers'
import { rig } from './orchestra-helpers'

const ROLES = Object.keys(ROLE_LOOK) as AgentRole[]
/** The runtime roles of the team tree (src/main/orchestra/roles.ts) plus the aliases the screens map. */
const RUNTIME_ROLES = ['principal', 'channel_lead', 'researcher', 'competitor_analyst', 'production_supervisor', 'scriptwriter', 'packaging', 'director', 'video_producer', 'qc_eye', 'publisher', 'sponsor_manager', 'pipeline_architect', 'voiceover']

afterEach(() => resetLookStore())

describe('a character for every role', () => {
  it('gives every role a default accessory, and a valid one', () => {
    for (const role of ROLES) {
      const d = ROLE_LOOK[role]
      expect(d.accessory, role).not.toBe('none')
      expect(ACCESSORY_IDS, role).toContain(d.accessory)
      expect(ACCESSORIES[d.accessory as Exclude<typeof d.accessory, 'none'>], role).toBeInstanceOf(Array)
    }
  })

  it('reads at a glance: the accessories of the brief, one per role, none shared', () => {
    expect(ROLE_LOOK.principal.accessory).toBe('compass') // Atlas, the base character
    expect(ROLE_LOOK.scriptwriter.accessory).toBe('quill')
    expect(ROLE_LOOK['competitor-analyst'].accessory).toBe('binoculars')
    expect(ROLE_LOOK['qc-eye']).toMatchObject({ accessory: 'checklist', face: 'monocle' })
    expect(ROLE_LOOK['pipeline-architect'].accessory).toBe('set-square')
    expect(ROLE_LOOK.voice.accessory).toBe('mic')
    expect(ROLE_LOOK.editor.accessory).toBe('clapper')
    const accessories = ROLES.map((r) => ROLE_LOOK[r].accessory)
    expect(new Set(accessories).size).toBe(accessories.length)
  })

  it('covers every runtime role of the team: none falls back to the plain custom character', () => {
    for (const role of RUNTIME_ROLES) {
      const proto = roleOf(role)
      expect(proto, role).not.toBe('custom')
      expect(ROLE_LOOK[proto], role).toBeDefined()
    }
    expect(roleOf('something_else')).toBe('custom')
  })

  it('draws every role in the viewBox, crisp (SVG only: no image, no font, no <style>)', () => {
    for (const role of ROLES) {
      const html = renderToStaticMarkup(<Mascot role={role} size={32} />)
      expect(html, role).toContain('viewBox="5 5 56 56"')
      expect(html, role).toContain(`data-accessory="${ROLE_LOOK[role].accessory}"`)
      expect(html, role).not.toMatch(/<image|<style|<foreignObject|<filter|Gradient|url\(|font-family/)
    }
    // an unknown role draws the plain character instead of throwing
    expect(renderToStaticMarkup(<Mascot role="nobody" />)).toContain(`data-accessory="${ROLE_LOOK.custom.accessory}"`)
  })

  it('draws every accessory, and the gallery shows every role at three sizes', () => {
    for (const id of ACCESSORY_IDS) expect(renderToStaticMarkup(<Mascot role="custom" look={{ accessory: id }} />), id).toContain(`data-accessory="${id}"`)
    const html = renderToStaticMarkup(<MascotGallery />)
    for (const role of ROLES) expect(html, role).toContain(`mascot-role-${role}`)
    expect(html.match(/data-slot="mascot"/g)?.length).toBe(ROLES.length * 3 + ACCESSORY_IDS.length)
  })
})

describe('the light customisation', () => {
  it('puts the owner’s choices over the role, and the colour over the agent’s own', () => {
    expect(resolveLook('scriptwriter', null, 3)).toMatchObject({ accessory: 'quill', color: 3, hat: 'beret' })
    expect(resolveLook('scriptwriter', { accessory: 'mic', color: 6 }, 3)).toMatchObject({ accessory: 'mic', color: 6, hat: 'beret' })
    expect(resolveLook('scriptwriter', { accessory: 'none' }, 3).accessory).toBe('none')
    expect(resolveLook('scriptwriter', null, 11).color).toBe(3) // any index lands on one of the 8 colours
  })

  it('offers a short list: the role’s own accessory first, the common ones, then empty hands', () => {
    const list = accessoryChoices('scriptwriter')
    expect(list[0]).toBe('quill')
    expect(list.at(-1)).toBe('none')
    expect(list.length).toBeLessThanOrEqual(10)
    expect(new Set(list).size).toBe(list.length)
    expect(accessoryChoices('voice')[0]).toBe('mic')
    for (const c of COMMON_ACCESSORIES) expect(list).toContain(c)
  })

  it('checks a look before it is stored', () => {
    expect(checkLook({ color: 2, accessory: 'mic' })).toEqual({ color: 2, accessory: 'mic' })
    expect(checkLook({})).toBeNull()
    expect(checkLook(null)).toBeNull()
    expect(checkLook({ color: 2, hat: 'crown' })).toEqual({ color: 2 }) // only the two choices exist
    expect(() => checkLook({ color: MASCOT_COLOR_COUNT })).toThrow(/couleur/)
    expect(() => checkLook({ color: 1.5 })).toThrow(/couleur/)
    expect(() => checkLook({ accessory: 'rocket-launcher' })).toThrow(/Unknown accessory/)
    expect(() => checkLook([])).toThrow(/objet/)
    expect(parseLook('{"color":99}')).toBeNull() // a damaged value is ignored
    expect(parseLook('not json')).toBeNull()
  })

  it('the editor marks the current colour and accessory, and offers the way back once something is chosen', () => {
    const plain = renderToStaticMarkup(<MascotEditor role="scriptwriter" look={null} colorIndex={3} onChange={() => undefined} />)
    expect(plain).toMatch(/data-testid="mascot-color-3"[^>]*>/)
    expect(plain).toMatch(/aria-checked="true"[^>]*data-testid="mascot-color-3"/)
    expect(plain).toMatch(/aria-checked="true"[^>]*data-testid="mascot-accessory-quill"/)
    expect(plain).not.toContain('mascot-reset')
    const chosen = renderToStaticMarkup(<MascotEditor role="scriptwriter" look={{ accessory: 'mic' }} colorIndex={3} onChange={() => undefined} />)
    expect(chosen).toMatch(/aria-checked="true"[^>]*data-testid="mascot-accessory-mic"/)
    expect(chosen).toContain('mascot-reset')
  })

  it('stores a choice equal to the role’s default as « nothing », so the character keeps following its role', () => {
    expect(nextLook('scriptwriter', null, 3, { accessory: 'mic' })).toEqual({ accessory: 'mic' })
    expect(nextLook('scriptwriter', { accessory: 'mic' }, 3, { color: 6 })).toEqual({ accessory: 'mic', color: 6 })
    expect(nextLook('scriptwriter', { accessory: 'mic', color: 6 }, 3, { accessory: 'quill' })).toEqual({ color: 6 })
    expect(nextLook('scriptwriter', { color: 6 }, 3, { color: 3 })).toBeNull()
    expect(nextLook('scriptwriter', null, 11, { color: 3 })).toBeNull() // index 11 is colour 3 too
  })
})

describe('on the agent', () => {
  it('stores the look on the agent, validates it, and clears it', () => {
    const r = rig()
    const o = r.core.orchestra
    const writer = o.agents().find((a) => a.role === 'scriptwriter')!
    expect(writer.look).toBeNull()
    expect(o.updateAgent(writer.id, { look: { color: 5, accessory: 'mic' } }).look).toEqual({ color: 5, accessory: 'mic' })
    expect(o.agents().find((a) => a.id === writer.id)!.look).toEqual({ color: 5, accessory: 'mic' })
    // the other agents are untouched; a model-policy edit (what the effort switch sends) keeps the look
    expect(o.agents().filter((a) => a.look !== null)).toHaveLength(1)
    o.updateAgent(writer.id, { policy: { tier: 'fast' } })
    expect(o.agents().find((a) => a.id === writer.id)!.look).toEqual({ color: 5, accessory: 'mic' })
    expect(() => o.updateAgent(writer.id, { look: { accessory: 'rocket-launcher' } as never })).toThrow(/Unknown accessory/)
    expect(o.agents().find((a) => a.id === writer.id)!.look).toEqual({ color: 5, accessory: 'mic' })
    expect(o.updateAgent(writer.id, { look: null }).look).toBeNull()
  })

  describe('across a restart', () => {
    const dirs: string[] = []
    afterEach(() => {
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
    })

    it('keeps the look when the app is closed and opened again', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'atelier-look-'))
      dirs.push(dir)
      const open = () => createCore({ paths: { userData: dir }, cipher: testCipher(), tester: okTester, orchestra: { cronUtc: true, dataDir: dir } })
      const first = open()
      first.orchestra.seed()
      const agent = first.orchestra.agents().find((a) => a.role === 'principal')!
      first.orchestra.updateAgent(agent.id, { look: { color: 4, accessory: 'star' } })
      first.close()
      const second = open()
      expect(second.orchestra.agents().find((a) => a.role === 'principal')!.look).toEqual({ color: 4, accessory: 'star' })
      second.close()
    })
  })

  it('has a migration for it and nothing else changed in orch_agents', () => {
    const core = memoryCore()
    const cols = (core.db.prepare('PRAGMA table_info(orch_agents)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('look')
    core.close()
  })
})

describe('the avatar', () => {
  it('draws the mascot of an agent that has a role, with the status dot out of the accessory’s corner', () => {
    const html = renderToStaticMarkup(<AgentAvatar agent={{ id: 'a1', name: 'Léa', role: 'scriptwriter', colorIndex: 2, status: 'working' }} size={32} />)
    expect(html).toContain('data-slot="mascot"')
    expect(html).toContain('data-accessory="quill"')
    expect(html).toContain('-top-px')
    expect(html).not.toContain('radial-gradient')
  })

  it('keeps the coloured bubble when the caller only knows the colour', () => {
    const html = renderToStaticMarkup(<AgentAvatar agent={{ name: 'Léa', colorIndex: 2, status: 'idle' }} size={32} />)
    expect(html).not.toContain('data-slot="mascot"')
    expect(html).toContain('radial-gradient')
  })

  it('shows a look chosen in the session on every avatar of that agent, and the way back', () => {
    const agent = { id: 'a1', name: 'Léa', role: 'scriptwriter' as const, colorIndex: 2, status: 'idle' as const }
    setLookOverride('a1', { accessory: 'magnifier' })
    expect(renderToStaticMarkup(<AgentAvatar agent={agent} />)).toContain('data-accessory="magnifier"')
    expect(renderToStaticMarkup(<AgentAvatar agent={{ ...agent, id: 'a2' }} />)).toContain('data-accessory="quill"')
    setLookOverride('a1', null)
    expect(renderToStaticMarkup(<AgentAvatar agent={{ ...agent, look: { accessory: 'mic' } }} />)).toContain('data-accessory="quill"')
  })
})

setLocale('fr')
