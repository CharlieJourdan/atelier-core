// Founder console › Versions: the app releases pushed to the beta testers. On Atelier Cloud (site built with
// VITE_ATELIER_CLOUD) the list, the publication and the withdrawal are the server's; without it the page works on invented
// releases, like the other mock-up pages. The upload itself is `npm run release` (docs/RELEASES.md): the console shows
// what the Cloud holds and decides what the testers receive.
import { useCallback, useEffect, useState } from 'react'
import { CloudCallError, cloudBase, cloudCall, cloudEnabled } from '../cloud'
import { Button } from '../ui'
import { Chip2, Dialog, Drawer, PageHeader, Panel, Status, Table, td, th, useToast, type StatusTone } from './kit'
import {
  CHANNEL_LABEL,
  DEMO_RELEASES,
  PLATFORM_LABEL,
  STATE_LABEL,
  dateLabel,
  feedUrl,
  latestOf,
  releaseBytes,
  sizeLabel,
  sortReleases,
  type Channel,
  type Platform,
  type ReleaseRow,
  type ReleaseState
} from './releases'

type Action = 'publish' | 'withdraw' | 'delete'
type Filter = 'all' | Channel

const TONE: Record<ReleaseState, StatusTone> = { draft: 'idle', published: 'ok', withdrawn: 'warn' }
const COMBOS: readonly [Channel, Platform][] = [
  ['beta', 'win'],
  ['stable', 'win'],
  ['beta', 'mac'],
  ['stable', 'mac']
]

const CONFIRM: Record<Action, { title: (r: ReleaseRow) => string; body: (r: ReleaseRow) => string; ok: string }> = {
  publish: {
    title: (r) => `Publier la version ${r.version} ?`,
    body: (r) => `Les testeurs du canal ${CHANNEL_LABEL[r.channel].toLowerCase()} (${PLATFORM_LABEL[r.platform]}) la reçoivent à leur prochaine vérification : au démarrage de l’app, puis toutes les 4 heures.`,
    ok: 'Publier'
  },
  withdraw: {
    title: (r) => `Retirer la version ${r.version} ?`,
    body: () => `Elle disparaît du flux : la version publiée juste avant redevient la dernière. Ceux qui l’ont déjà installée la gardent (une app ne revient pas en arrière toute seule : pour corriger, publie une version plus haute).`,
    ok: 'Retirer'
  },
  delete: {
    title: (r) => `Supprimer le brouillon ${r.version} ?`,
    body: () => 'Le brouillon et ses fichiers sont effacés du Cloud. Une version publiée ou retirée, elle, reste dans l’historique.',
    ok: 'Supprimer'
  }
}

/** The steps of the loop, shown at the top of the page. */
export function HowTo() {
  const steps: [string, string][] = [
    ['Modifier', 'Lance l’app en développement (npm run dev), change ce que tu veux, essaie : l’écran se recharge tout seul.'],
    ['Pousser', 'Monte la version (npm version patch) puis lance npm run release -- --channel beta --notes "Ce qui change". Elle construit l’installeur et l’envoie au Cloud.'],
    ['Les testeurs la reçoivent', 'Leur app cherche une mise à jour au démarrage puis toutes les 4 heures, la télécharge en arrière-plan et l’installe à la fermeture (ou au clic sur « Redémarrer pour installer »).']
  ]
  return (
    <Panel title="Comment pousser une mise à jour" sub="Modifier → npm run release → les testeurs reçoivent la MAJ">
      <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-3" data-testid="versions-howto">
        {steps.map(([title, text], i) => (
          <li key={title} className="rounded-[12px] bg-surface-2 p-4">
            <p className="m-0 text-[13px] font-medium text-fg">
              {i + 1}. {title}
            </p>
            <p className="m-0 mt-1.5 text-[13px] leading-[1.5] text-fg-2">{text}</p>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-3 text-[12px] text-fg-3">Un brouillon qui reste ici (envoi interrompu) se publie d’un clic ; une version publiée par erreur se retire d’un clic, puis tu en publies une plus haute.</p>
    </Panel>
  )
}

export interface VersionsViewProps {
  releases: ReleaseRow[]
  /** The Cloud's address, for the feed links (null in the mock-up). */
  cloud: string | null
  demo: boolean
  busy: string | null
  onAction: (r: ReleaseRow, a: Action) => void
}

/** The page body, from data: easy to render in a test. */
export function VersionsView({ releases, cloud, demo, busy, onAction }: VersionsViewProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<ReleaseRow | null>(null)
  const [asking, setAsking] = useState<{ release: ReleaseRow; action: Action } | null>(null)
  const rows = sortReleases(releases).filter((r) => filter === 'all' || r.channel === filter)
  const latestIds = new Set(COMBOS.map(([c, p]) => latestOf(releases, c, p)?.id))
  const base = cloud ?? 'https://api.exemple.fr'
  const shown = open ? (releases.find((r) => r.id === open.id) ?? open) : null

  return (
    <div className="grid gap-4" data-testid="admin-versions">
      <HowTo />

      <Panel title="Ce que reçoivent les testeurs" sub="La dernière version publiée de chaque canal : c’est elle que l’app trouve dans son flux de mises à jour.">
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4" data-testid="versions-latest">
          {COMBOS.map(([channel, platform]) => {
            const r = latestOf(releases, channel, platform)
            return (
              <li key={`${channel}-${platform}`} className="rounded-[12px] border border-line p-4">
                <p className="m-0 text-[12px] text-fg-3">
                  {CHANNEL_LABEL[channel]} · {PLATFORM_LABEL[platform]}
                </p>
                <p className="num m-0 mt-1 text-[22px] font-medium tracking-[-0.02em]">{r ? r.version : 'Rien de publié'}</p>
                <p className="m-0 mt-1 text-[12px] text-fg-3">{r ? `publiée le ${dateLabel(r.publishedAt)}` : 'Le flux répond « introuvable »'}</p>
                {r && <p className="m-0 mt-2 break-all font-mono text-[11px] text-fg-3">{feedUrl(base, channel, platform)}</p>}
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel
        title="Toutes les versions"
        actions={
          <div className="flex gap-1.5" role="group" aria-label="Canal">
            {(['all', 'beta', 'stable'] as const).map((f) => (
              <Chip2 key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Tous' : CHANNEL_LABEL[f]}
              </Chip2>
            ))}
          </div>
        }
        flush
      >
        {rows.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[13px] text-fg-3" data-testid="versions-empty">
            Aucune version pour l’instant. Lance npm run release pour envoyer la première.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Version</th>
                <th className={th}>Canal</th>
                <th className={th}>Plateforme</th>
                <th className={th}>État</th>
                <th className={`${th} text-right`}>Fichiers</th>
                <th className={th}>Publiée le</th>
                <th className={th}>Notes</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`release-${r.id}`}>
                  <td className={`${td} font-medium text-fg`}>
                    <button type="button" className="num cursor-pointer border-0 bg-transparent p-0 text-left font-medium text-fg underline-offset-2 hover:underline" onClick={() => setOpen(r)}>
                      {r.version}
                    </button>
                    {latestIds.has(r.id) && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-fg-2">dernière</span>}
                  </td>
                  <td className={td}>{CHANNEL_LABEL[r.channel]}</td>
                  <td className={td}>{PLATFORM_LABEL[r.platform]}</td>
                  <td className={td}>
                    <Status tone={TONE[r.state]}>{STATE_LABEL[r.state]}</Status>
                  </td>
                  <td className={`${td} num text-right`}>
                    {r.files.length} · {sizeLabel(releaseBytes(r))}
                  </td>
                  <td className={td}>{dateLabel(r.publishedAt)}</td>
                  <td className={`${td} max-w-[260px] truncate`} title={r.notes}>
                    {r.notes.split('\n')[0] || '–'}
                  </td>
                  <td className={`${td} text-right`}>
                    <span className="inline-flex gap-1.5">
                      {r.state !== 'published' && (
                        <Button size="sm" disabled={busy === r.id} aria-label={`${r.state === 'draft' ? 'Publier' : 'Republier'} la version ${r.version}`} onClick={() => setAsking({ release: r, action: 'publish' })}>
                          {r.state === 'draft' ? 'Publier' : 'Republier'}
                        </Button>
                      )}
                      {r.state === 'published' && (
                        <Button size="sm" variant="secondary" disabled={busy === r.id} aria-label={`Retirer la version ${r.version}`} onClick={() => setAsking({ release: r, action: 'withdraw' })}>
                          Retirer
                        </Button>
                      )}
                      {r.state === 'draft' && (
                        <Button size="sm" variant="ghost" disabled={busy === r.id} aria-label={`Supprimer le brouillon ${r.version}`} onClick={() => setAsking({ release: r, action: 'delete' })}>
                          Supprimer
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {demo && (
        <p className="m-0 text-[12px] text-fg-3" data-testid="versions-demo">
          Démonstration : ces versions sont inventées et rien n’est envoyé. Avec la console branchée sur Atelier Cloud, cette liste est celle du serveur.
        </p>
      )}

      {shown && (
        <Drawer title={`Version ${shown.version}`} sub={`${CHANNEL_LABEL[shown.channel]} · ${PLATFORM_LABEL[shown.platform]} · ${STATE_LABEL[shown.state]}`} onClose={() => setOpen(null)}>
          <div className="grid gap-4 p-5" data-testid="release-detail">
            <div>
              <p className="m-0 text-[12px] font-medium text-fg-2">Notes pour les testeurs</p>
              <p className="m-0 mt-1 whitespace-pre-line text-[13px] text-fg-2">{shown.notes || 'Aucune note.'}</p>
            </div>
            <div>
              <p className="m-0 text-[12px] font-medium text-fg-2">Fichiers</p>
              <ul className="m-0 mt-1 grid list-none gap-2 p-0">
                {shown.files.map((f) => (
                  <li key={f.name} className="text-[12px] text-fg-2">
                    <span className="font-mono">{f.name}</span> · {sizeLabel(f.size)}
                    <span className="block break-all font-mono text-[11px] text-fg-3">sha512 {f.sha512}</span>
                  </li>
                ))}
                {shown.files.length === 0 && <li className="text-[12px] text-fg-3">Aucun fichier envoyé.</li>}
              </ul>
            </div>
            <p className="m-0 text-[12px] text-fg-3">
              Créée le {dateLabel(shown.createdAt)}
              {shown.withdrawnAt ? ` · retirée le ${dateLabel(shown.withdrawnAt)}` : ''}
            </p>
          </div>
        </Drawer>
      )}

      {asking && (
        <Dialog
          title={CONFIRM[asking.action].title(asking.release)}
          onClose={() => setAsking(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(null)}>
                Annuler
              </Button>
              <Button
                data-testid="versions-confirm"
                onClick={() => {
                  onAction(asking.release, asking.action)
                  setAsking(null)
                }}
              >
                {CONFIRM[asking.action].ok}
              </Button>
            </>
          }
        >
          <p className="m-0 text-[14px] leading-[1.55] text-fg-2">{CONFIRM[asking.action].body(asking.release)}</p>
        </Dialog>
      )}
    </div>
  )
}

const errText = (e: unknown): string => (e instanceof CloudCallError || e instanceof Error ? e.message : String(e))

export function Versions() {
  const toast = useToast()
  const live = cloudEnabled()
  const [releases, setReleases] = useState<ReleaseRow[]>(live ? [] : DEMO_RELEASES)
  const [loaded, setLoaded] = useState(!live)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback((): void => {
    if (!live) return
    cloudCall<{ releases: ReleaseRow[] }>('/v1/admin/releases')
      .then((r) => {
        setReleases(r.releases)
        setError(null)
        setLoaded(true)
      })
      .catch((e: unknown) => setError(errText(e)))
  }, [live])
  useEffect(load, [load])

  const act = (r: ReleaseRow, action: Action): void => {
    const done: Record<Action, string> = {
      publish: `Version ${r.version} publiée : les testeurs la reçoivent à leur prochaine vérification.`,
      withdraw: `Version ${r.version} retirée du flux.`,
      delete: `Brouillon ${r.version} supprimé.`
    }
    if (!live) {
      // the mock-up: the same moves on the invented list
      setReleases((list) =>
        action === 'delete'
          ? list.filter((x) => x.id !== r.id)
          : list.map((x) => (x.id === r.id ? { ...x, state: action === 'publish' ? 'published' : 'withdrawn', publishedAt: action === 'publish' ? new Date().toISOString() : x.publishedAt, withdrawnAt: action === 'withdraw' ? new Date().toISOString() : null } : x))
      )
      toast(`${done[action]} (démo)`)
      return
    }
    setBusy(r.id)
    cloudCall(`/v1/admin/releases/${encodeURIComponent(r.id)}/${action}`, { method: 'POST' })
      .then(() => toast(done[action]))
      .catch((e: unknown) => toast(`Refusé : ${errText(e)}`))
      .finally(() => {
        setBusy(null)
        load()
      })
  }

  return (
    <>
      <PageHeader title="Versions" sub="Les versions de l’app envoyées aux testeurs : ce qu’ils reçoivent, quand, et le retour en arrière si une version pose problème." />
      {error && <p className="m-0 mb-4 text-[13px] text-fg-2">Atelier Cloud ne répond pas : {error}</p>}
      {loaded ? <VersionsView releases={releases} cloud={cloudBase()} demo={!live} busy={busy} onAction={act} /> : !error && <p className="m-0 text-[13px] text-fg-3">Chargement…</p>}
    </>
  )
}
