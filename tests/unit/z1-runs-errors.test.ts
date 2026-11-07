// Lot Z1: runs IPC surface: the method list, refused arguments (French messages), actions on runs in the wrong state,
// the package folder opener, the wallet methods, and the example workspace's runs (seed and clear).
import { afterEach, describe, expect, it } from 'vitest'
import { RUNS_METHODS } from '../../src/shared/api'
import type { RunStartInput } from '../../src/shared/api'
import { fixture, waitFor, type Fixture } from './z1-runs-fixtures'
import { memoryCore } from './helpers'

type Core = ReturnType<typeof memoryCore>

/** The core's API with every call async, so a handler that throws synchronously rejects like the IPC does. */
const asyncApi = (core: Core): Core['api'] =>
  new Proxy(core.api, { get: (t, k) => async (...a: unknown[]) => (t as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string]!(...a) })

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

async function setup(opened: string[] = []): Promise<{ core: Core; api: Core['api']; fx: Fixture; channelId: number }> {
  const fx = fixture()
  fx.productionRuns.opener = (dir: string) => {
    opened.push(dir)
    return Promise.resolve('')
  }
  const core = memoryCore({ productionRuns: fx.productionRuns })
  cleanups.push(() => core.close(), () => fx.cleanup())
  const api = asyncApi(core)
  const channel = await api['channels.create']({ name: 'Chaîne de test' })
  return { core, api, fx, channelId: channel.id }
}

const start = (channelId: number, over: Partial<RunStartInput> = {}): RunStartInput => ({
  channelId,
  title: 'Ma vidéo',
  topic: 'Un sujet',
  minutes: 1,
  budgetMode: 'usage_max',
  gateMode: 'all',
  ...over
})

describe('runs IPC', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...RUNS_METHODS]).toEqual([
      'production.quote', // devis des deux modes de budget, par étape
      'production.start', // crée la fabrication (et la vidéo) et lance le moteur
      'production.list', // fabrications, la plus récente d'abord, filtrables
      'production.get', // une fabrication avec ses étapes
      'production.approve', // valide l'étape qui attend à sa porte
      'production.requestChanges', // renvoie l'étape avec une note
      'production.cancel', // arrête, rend les crédits non dépensés
      'production.retry', // relance une fabrication en échec / annulée / interrompue
      'production.redo', // « Refaire pareil » sur une nouvelle vidéo
      'production.resume', // rattache une fabrication interrompue ou sans moteur
      'production.output', // ce qu'une étape a produit, typé pour sa revue
      'production.file', // octets d'un fichier, confiné au dossier d'artefacts
      'production.library', // vidéos terminées
      'production.voices', // voix utilisables sur cet ordinateur
      'production.engineStatus', // état du moteur (Réglages › Moteur)
      'production.revealPackage', // ouvre le dossier du paquet
      'credits.balance', // solde du portefeuille local
      'credits.entries', // mouvements du portefeuille
      'credits.packs', // paquets de crédits en vente
      'credits.simulatePurchase' // achat simulé, aucun paiement
    ])
  })

  it('refuses bad arguments with French messages, and creates nothing', async () => {
    const { api, channelId } = await setup()
    const s = (over: Record<string, unknown>) => api['production.start']({ ...start(channelId), ...over } as RunStartInput)
    await expect(api['production.start'](null as never)).rejects.toThrow('Paramètres de fabrication invalides.')
    await expect(s({ topic: '' })).rejects.toThrow('Sujet : texte attendu')
    await expect(s({ topic: 'x'.repeat(2001) })).rejects.toThrow('Sujet : texte attendu')
    await expect(s({ title: ' ' })).rejects.toThrow('Titre : texte attendu')
    await expect(s({ minutes: 0 })).rejects.toThrow('Durée invalide')
    await expect(s({ minutes: 31 })).rejects.toThrow('Durée invalide : entre 0,5 et 30 minutes.')
    await expect(s({ minutes: Number.NaN })).rejects.toThrow('Durée invalide')
    await expect(s({ budgetMode: 'gratuit' })).rejects.toThrow('Mode de budget inconnu.')
    await expect(s({ gateMode: 'jamais' })).rejects.toThrow('Mode de validation inconnu.')
    await expect(s({ channelId: -1 })).rejects.toThrow('Chaîne invalide.')
    await expect(s({ channelId: 9999 })).rejects.toThrow('Chaîne introuvable.')
    await expect(s({ videoId: 9999, channelId: undefined, title: undefined })).rejects.toThrow('Vidéo introuvable.')
    await expect(s({ videoId: 1 })).rejects.toThrow('Donne soit une vidéo, soit une chaîne et un titre.')
    await expect(s({ channelId: undefined })).rejects.toThrow('Choisis une vidéo, ou une chaîne et un titre.')
    await expect(s({ style: { captions: 'inconnu' } })).rejects.toThrow('Style de sous-titres inconnu.')
    await expect(s({ style: { voice: 3 } })).rejects.toThrow('Voix : texte attendu')
    await expect(s({ style: { surprise: true } })).rejects.toThrow('réglage inconnu')
    await expect(s({ style: { language: 'francais' } })).rejects.toThrow('Langue invalide')
    await expect(s({ seeds: { voice: -1 } })).rejects.toThrow('Grains invalides')
    await expect(api['production.quote']({ minutes: 99 })).rejects.toThrow('Durée invalide')
    expect(await api['production.list']()).toEqual([])
    expect(await api['videos.list']()).toEqual([])
  })

  it('refuses an archived channel and unknown or malformed run ids and node ids', async () => {
    const { api, channelId } = await setup()
    const archived = await api['channels.create']({ name: 'Vieille chaîne' })
    await api['channels.archive'](archived.id)
    await expect(api['production.start'](start(archived.id))).rejects.toThrow('Cette chaîne est archivée.')
    for (const bad of [0, -3, 1.5, '1', null]) {
      await expect(api['production.get'](bad as never)).rejects.toThrow('Identifiant de fabrication invalide.')
    }
    await expect(api['production.get'](4242)).rejects.toThrow('Fabrication introuvable.')
    await expect(api['production.cancel'](4242)).rejects.toThrow('Fabrication introuvable.')
    await expect(api['production.redo'](4242)).rejects.toThrow('Fabrication introuvable.')
    await expect(api['production.list']({ status: 'fini' as never })).rejects.toThrow('Filtre invalide : statut.')
    await expect(api['production.list']({ limit: 0 })).rejects.toThrow('Filtre invalide : limite')
    await expect(api['production.list']({ channelId: 'a' as never })).rejects.toThrow('Filtre invalide')
    await expect(api['production.library']({ channelId: -1 })).rejects.toThrow('Filtre invalide : chaîne.')
    await expect(api['production.library']([] as never)).rejects.toThrow('Filtre de bibliothèque invalide.')
    const run = await api['production.start'](start(channelId))
    await expect(api['production.output'](run.id, 'nope')).rejects.toThrow('Cette étape n’existe pas dans la fabrication.')
    await expect(api['production.output'](run.id, '')).rejects.toThrow('Étape invalide.')
    await expect(api['production.approve'](run.id, 'x'.repeat(65))).rejects.toThrow('Étape invalide.')
  })

  it('refuses actions on a run in the wrong state, and bad change notes', async () => {
    const { api, channelId } = await setup()
    const run = await api['production.start'](start(channelId))
    const waiting = await waitFor(async () => {
      const r = await api['production.get'](run.id)
      return r.status === 'waiting' ? r : null
    }, 8_000, 'waiting')
    expect(waiting.waitingNodes).toEqual(['package'])
    await expect(api['production.approve'](run.id, 'script')).rejects.toThrow('Cette étape n’attend pas ta validation.')
    await expect(api['production.requestChanges'](run.id, 'package', '')).rejects.toThrow('Note de correction : texte attendu')
    await expect(api['production.requestChanges'](run.id, 'package', '   ')).rejects.toThrow('Note de correction : texte attendu')
    await expect(api['production.requestChanges'](run.id, 'package', 'x'.repeat(2001))).rejects.toThrow('Note de correction : texte attendu')
    await expect(api['production.requestChanges'](run.id, 'package', 7 as never)).rejects.toThrow('Note de correction : texte attendu')
    await expect(api['production.requestChanges'](run.id, 'script', 'ok')).rejects.toThrow('Cette étape n’attend pas ta validation.')
    await expect(api['production.retry'](run.id)).rejects.toThrow('Seule une fabrication en échec, annulée ou interrompue peut être relancée.')
    await api['production.approve'](run.id, 'package')
    await waitFor(async () => (await api['production.get'](run.id)).status === 'succeeded', 8_000, 'succeeded')
    await expect(api['production.cancel'](run.id)).rejects.toThrow('Cette fabrication est déjà terminée.')
    await expect(api['production.resume'](run.id)).rejects.toThrow('Cette fabrication ne peut pas être reprise')
    await expect(api['production.approve'](run.id, 'package')).rejects.toThrow('Cette étape n’attend pas ta validation.')
    await expect(api['production.output'](run.id, 'research')).resolves.toMatchObject({ kind: 'text' })
  })

  it('a node that did not run has no output: a French "not ready" message', async () => {
    const { api, fx, channelId } = await setup()
    fx.block.add('voice.tts@1')
    const run = await api['production.start'](start(channelId))
    await waitFor(async () => (await api['production.get'](run.id)).nodes.find((n) => n.nodeId === 'voice')?.state === 'running', 8_000, 'voice running')
    const out = await api['production.output'](run.id, 'render')
    expect(out).toMatchObject({ kind: 'unavailable', reason: 'not_ready' })
    expect(out.kind === 'unavailable' && out.message).toBe('Cette étape n’a pas encore de résultat.')
    await api['production.cancel'](run.id)
  })

  it('opens the package folder of a finished run, and refuses before it exists', async () => {
    const opened: string[] = []
    const { api, channelId } = await setup(opened)
    const run = await api['production.start'](start(channelId))
    await expect(api['production.revealPackage'](run.id)).rejects.toThrow('Cette fabrication n’a pas encore de paquet.')
    await waitFor(async () => (await api['production.get'](run.id)).status === 'waiting', 8_000, 'waiting')
    await api['production.approve'](run.id, 'package')
    const done = await waitFor(async () => {
      const r = await api['production.get'](run.id)
      return r.status === 'succeeded' ? r : null
    }, 8_000, 'succeeded')
    const res = await api['production.revealPackage'](run.id)
    expect(res).toEqual({ opened: true, path: done.packageDir })
    expect(opened).toEqual([done.packageDir])
  })

  it('serves the engine status and the voice list', async () => {
    const { api } = await setup()
    const st = await api['production.engineStatus']()
    expect(st.activeRuns).toBe(0)
    expect(st.cloudConnected).toBe(false)
    expect(st.note).toContain('lot P5')
    const v = await api['production.voices']()
    expect(Array.isArray(v.voices)).toBe(true)
    expect(v.note.length).toBeGreaterThan(0)
  })
})

describe('credits IPC', () => {
  it('reads the wallet, lists packs, and a simulated purchase is recorded as such (double click deduped)', async () => {
    const { api } = await setup()
    expect((await api['credits.balance']()).total).toBe(0)
    expect((await api['credits.packs']()).map((p) => p.id)).toEqual(['pack-500', 'pack-2000', 'pack-10000'])
    const buy = await api['credits.simulatePurchase']('pack-500', 'double-click-key')
    expect(buy.simulated).toBe(true)
    expect(buy.entry).toMatchObject({ kind: 'grant', amount: 500, source: 'simulated_purchase' })
    const again = await api['credits.simulatePurchase']('pack-500', 'double-click-key')
    expect(again.entry.id).toBe(buy.entry.id)
    expect(again.balance).toEqual({ available: 500, held: 0, total: 500, simulated: 500, example: 0 })
    expect(await api['credits.entries'](1)).toHaveLength(1)
  })

  it('refuses bad wallet arguments in French', async () => {
    const { api } = await setup()
    await expect(api['credits.entries'](0)).rejects.toThrow('Nombre de lignes invalide (1 à 500).')
    await expect(api['credits.entries'](501)).rejects.toThrow('Nombre de lignes invalide')
    await expect(api['credits.entries'](1.5)).rejects.toThrow('Nombre de lignes invalide')
    await expect(api['credits.simulatePurchase']('pack-inconnu')).rejects.toThrow('Pack de crédits inconnu')
    await expect(api['credits.simulatePurchase'](42 as never)).rejects.toThrow('Pack de crédits inconnu.')
    await expect(api['credits.simulatePurchase']('pack-500', 'x')).rejects.toThrow('Clé d’achat invalide.')
    expect((await api['credits.balance']()).total).toBe(0)
  })
})

describe('example workspace: runs', () => {
  it('loads finished runs, one run waiting at the script, and an example grant; deleting leaves nothing', async () => {
    const core = memoryCore()
    cleanups.push(() => core.close())
    const api = asyncApi(core)
    await api['example.load']()
    const runs = await api['production.list']()
    expect(runs.length).toBeGreaterThanOrEqual(4)
    expect(runs.every((r) => r.example)).toBe(true)
    expect(runs.filter((r) => r.status === 'succeeded').length).toBeGreaterThanOrEqual(3)
    const waiting = runs.filter((r) => r.status === 'waiting')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]).toMatchObject({ live: false, waitingNodes: ['script'] })
    const lib = await api['production.library']()
    expect(lib.length).toBeGreaterThanOrEqual(3)
    expect(lib.every((i) => i.example)).toBe(true)
    const bal = await api['credits.balance']()
    expect(bal.example).toBeGreaterThan(0)
    const done = runs.find((r) => r.status === 'succeeded')!
    await expect(api['production.output'](done.id, 'script')).resolves.toMatchObject({ kind: 'unavailable', reason: 'example' })
    await api['example.delete']()
    expect(await api['production.list']()).toEqual([])
    expect(await api['production.library']()).toEqual([])
    expect(await api['credits.balance']()).toEqual({ available: 0, held: 0, total: 0, simulated: 0, example: 0 })
    expect(await api['credits.entries']()).toEqual([])
  })
})
