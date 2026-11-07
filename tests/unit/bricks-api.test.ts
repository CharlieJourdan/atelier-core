// The bricks.* IPC module (Production › Briques, « Briques sur mesure »): every method is in the contract; the list shows a channel's
// bricks with their state; a decision is only for a brick waiting for Charlie and goes through its inbox item; only a validated brick can be
// switched on or off for the films; « Demander une brique » is a message to Atlas naming the channel. The index lives in migration 024.
import { describe, expect, it } from 'vitest'
import { API_METHODS } from '../../src/shared/api'
import { BRICKS_METHODS } from '../../src/shared/api/bricks'
import { CARD } from './brick-fixture'
import { rig } from './orchestra-helpers'

describe('bricks.* over IPC', () => {
  it('lists its four methods in the contract', () => {
    expect([...BRICKS_METHODS]).toEqual(['bricks.list', 'bricks.decide', 'bricks.setEnabled', 'bricks.request'])
    for (const m of BRICKS_METHODS) expect(API_METHODS).toContain(m)
  })

  it('lists, refuses a decision on a draft, decides through the inbox item, switches a validated brick, sends a request to Atlas', async () => {
    const r = rig()
    const api = r.core.api
    const store = r.core.context.bricks
    const channel = r.channels[0]!
    expect(api['bricks.list']()).toEqual([])
    const { row } = store.draft(channel, CARD, { agentId: null, taskId: null })
    expect(api['bricks.list']()).toMatchObject([{ slug: 'fiche-personnage', state: 'draft', version: 1, lintOk: null, stills: [] }])
    expect(() => api['bricks.decide'](row.id, { approve: true })).toThrow(/not waiting for your decision/)
    expect(() => api['bricks.setEnabled'](row.id, true)).toThrow(/Only a validated brick/)
    // a proposal (as bricks.propose makes it): an inbox item, the brick waits
    const item = r.core.orchestra.parts.inbox.add({ taskId: null, agentId: null, kind: 'validate', title: 'Brique à valider : Fiche personnage', body: 'x', options: ['Valider', 'Refuser'] })
    store.propose(row.id, item.id)
    const sent = await api['bricks.decide'](row.id, { approve: false, note: 'Plus grand' })
    expect(sent).toMatchObject({ state: 'draft', note: 'Plus grand', approvedVersion: null })
    expect(r.core.orchestra.inbox(true).find((i) => i.id === item.id)).toMatchObject({ status: 'answered', answer: { choice: 'Refuser', text: 'Plus grand' } })
    // the same content drafted again keeps its version; a change makes v2
    expect(store.draft(channel, CARD, { agentId: null, taskId: null }).changed).toBe(false)
    const v2 = store.draft(channel, { ...CARD, description: 'Plus grand.' }, { agentId: null, taskId: null })
    expect(v2.row.version).toBe(2)
    const item2 = r.core.orchestra.parts.inbox.add({ taskId: null, agentId: null, kind: 'validate', title: 't', body: 'x', options: ['Valider', 'Refuser'] })
    store.propose(row.id, item2.id)
    expect(await api['bricks.decide'](row.id, { approve: true })).toMatchObject({ state: 'approved', approvedVersion: 2, enabled: true })
    expect(store.approvedFor(channel).map((b) => b.version)).toEqual([2])
    expect(api['bricks.setEnabled'](row.id, false)).toMatchObject({ enabled: false })
    expect(store.approvedFor(channel)).toEqual([])
    // a new draft of a validated brick leaves the validated version to the films until the new one is validated
    api['bricks.setEnabled'](row.id, true)
    store.draft(channel, { ...CARD, description: 'Encore.' }, { agentId: null, taskId: null })
    expect(store.byId(row.id)).toMatchObject({ state: 'draft', version: 3, approvedVersion: 2 })
    expect(store.approvedFor(channel).map((b) => b.version)).toEqual([2])
    // « Demander une brique »: a message to Atlas in his room, naming the channel
    expect(() => api['bricks.request']({ channelId: channel, text: ' ' })).toThrow(/Say what/)
    const req = api['bricks.request']({ channelId: channel, text: 'un rappel d’abonnement' }) as { conversationId: number }
    const last = r.core.db.prepare('SELECT body FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(req.conversationId) as { body: string }
    expect(last.body).toMatch(/Fais-moi une brique sur mesure pour la chaîne Histoire \(#1\) : un rappel d’abonnement/)
    // the index (migration 024): one row per channel and brick
    expect(() => r.core.db.prepare("INSERT INTO bricks (channel_id, slug, name, version, content_hash, created_at, updated_at) VALUES (?, 'fiche-personnage', 'x', 1, 'h', 'a', 'a')").run(channel)).toThrow(/UNIQUE/)
    expect(() => r.core.db.prepare("INSERT INTO bricks (channel_id, slug, name, version, state, content_hash, created_at, updated_at) VALUES (?, 'autre', 'x', 1, 'nope', 'h', 'a', 'a')").run(channel)).toThrow(/CHECK/)
    r.core.close()
  })
})
