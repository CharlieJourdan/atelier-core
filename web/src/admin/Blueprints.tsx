import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { cloudCall, cloudEnabled } from '../cloud'
import { Button, Segmented, cx } from '../ui'
import {
  HISTORY,
  KIND_LABEL,
  NODE_KINDS,
  PUBLISHED_V3,
  RUNNER_LABEL,
  RUNNERS,
  TIER_LABEL,
  TIERS,
  VALIDATE_LABEL,
  VALIDATES,
  kindWarnings,
  makeDraftV4,
  parseBlueprintText,
  pipelineCredits,
  stringify,
  type Blueprint,
  type BlueprintAgent,
  type BlueprintNode,
  type BlueprintPipeline,
  type Issue,
  type NodeKind,
  type Runner,
  type Tier,
  type Validate,
  type VersionEntry
} from './blueprint'
import { collapseDiff, diffLines } from './diff'
import { USERS } from './data'
import { Dialog, FieldLabel, PageHeader, Panel, SelectInput, Status, TextArea, TextInput, useToast } from './kit'

type View = 'form' | 'json'
type Section = 'agents' | 'pipelines'

const TIER_TONE: Record<Tier, 'idle' | 'info' | 'ok'> = { fast: 'idle', balanced: 'info', deep: 'ok' }

/* ------------------------------------------------------------------ form view */

function AgentsEditor({ bp, edit }: { bp: Blueprint; edit: (fn: (b: Blueprint) => void) => void }) {
  const [selected, setSelected] = useState(bp.agents[0]?.id ?? '')
  const agent = bp.agents.find((a) => a.id === selected) ?? bp.agents[0]
  const patch = (fn: (a: BlueprintAgent) => void): void =>
    edit((b) => {
      const a = b.agents.find((x) => x.id === (agent?.id ?? ''))
      if (a) fn(a)
    })
  return (
    <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
      <div>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Agents">
          {bp.agents.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelected(a.id)}
                aria-current={a.id === agent?.id}
                className={cx('flex w-full items-center justify-between gap-2 rounded-[8px] px-3 py-2 text-left text-[13px] transition-colors', a.id === agent?.id ? 'bg-selected text-fg' : 'text-fg-2 hover:bg-hover')}
              >
                <span className="truncate">{a.role || '(sans rôle)'}</span>
                <Status tone={TIER_TONE[a.tier]}>{TIER_LABEL[a.tier]}</Status>
              </button>
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => {
            const id = `agent-${bp.agents.length + 1}`
            edit((b) => void b.agents.push({ id, role: 'Nouvel agent', tier: 'balanced', routines: [], instructions: '' }))
            setSelected(id)
          }}
        >
          <Plus size={14} strokeWidth={1.75} />
          Ajouter un agent
        </Button>
      </div>
      {agent && (
        <div className="grid content-start gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="ag-role">Rôle</FieldLabel>
              <TextInput id="ag-role" value={agent.role} onChange={(e) => patch((a) => void (a.role = e.target.value))} />
            </div>
            <div>
              <FieldLabel htmlFor="ag-tier">Niveau de modèle</FieldLabel>
              <SelectInput id="ag-tier" value={agent.tier} onChange={(e) => patch((a) => void (a.tier = e.target.value as Tier))}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABEL[t]}
                  </option>
                ))}
              </SelectInput>
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="ag-routines">Routines (une par ligne)</FieldLabel>
            <TextArea id="ag-routines" value={agent.routines.join('\n')} onChange={(e) => patch((a) => void (a.routines = e.target.value.split('\n')))} className="min-h-[76px]" />
          </div>
          <div>
            <FieldLabel htmlFor="ag-instructions">Instructions</FieldLabel>
            <TextArea id="ag-instructions" value={agent.instructions} onChange={(e) => patch((a) => void (a.instructions = e.target.value))} className="min-h-[140px]" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[12px] text-fg-3">Identifiant : {agent.id}</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={bp.agents.length <= 1}
              onClick={() => {
                edit((b) => void (b.agents = b.agents.filter((a) => a.id !== agent.id)))
                setSelected(bp.agents.find((a) => a.id !== agent.id)?.id ?? '')
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              Supprimer cet agent
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function PipelinesEditor({ bp, edit }: { bp: Blueprint; edit: (fn: (b: Blueprint) => void) => void }) {
  const [selected, setSelected] = useState(bp.pipelines[0]?.id ?? '')
  const warnings = useMemo(() => kindWarnings(bp), [bp])
  const pipe: BlueprintPipeline | undefined = bp.pipelines.find((p) => p.id === selected) ?? bp.pipelines[0]
  const patchPipe = (fn: (p: BlueprintPipeline) => void): void =>
    edit((b) => {
      const p = b.pipelines.find((x) => x.id === (pipe?.id ?? ''))
      if (p) fn(p)
    })
  const patchNode = (index: number, fn: (n: BlueprintNode) => void): void =>
    patchPipe((p) => {
      const n = p.nodes[index]
      if (n) fn(n)
    })
  return (
    <div className="grid gap-4">
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Pipelines">
        {bp.pipelines.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setSelected(p.id)}
              aria-current={p.id === pipe?.id}
              className={cx(
                'inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] transition-colors',
                p.id === pipe?.id ? 'bg-ink text-ink-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'
              )}
            >
              {p.name}
              <span className={cx('num text-[12px]', p.id === pipe?.id ? 'text-ink-fg/70' : 'text-fg-3')}>{pipelineCredits(p)} cr.</span>
            </button>
          </li>
        ))}
      </ul>
      {pipe && (
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="w-full max-w-[320px]">
              <FieldLabel htmlFor="pl-name">Nom du pipeline</FieldLabel>
              <TextInput id="pl-name" value={pipe.name} onChange={(e) => patchPipe((p) => void (p.name = e.target.value))} />
            </div>
            <p className="num m-0 text-[13px] text-fg-3">
              {pipe.nodes.length} étapes · <span className="text-fg">{pipelineCredits(pipe)} crédits</span> par vidéo
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr>
                  {['Étape', 'Type', 'Exécuteur', 'Fournisseur', 'Crédits', 'Validation', ''].map((h) => (
                    <th key={h} className="border-b border-line-2 px-2 py-2 text-left text-[12px] font-medium text-fg-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pipe.nodes.map((n, i) => (
                  <tr key={`${n.id}-${i}`} className="align-top">
                    <td className="border-b border-line px-2 py-1.5">
                      <TextInput aria-label={`Libellé de l’étape ${i + 1}`} value={n.label} onChange={(e) => patchNode(i, (x) => void (x.label = e.target.value))} className="min-w-[120px]" />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <SelectInput
                        aria-label={`Type de l’étape ${i + 1}`}
                        value={n.kind ?? ''}
                        onChange={(e) =>
                          patchNode(i, (x) => {
                            if (e.target.value === '') delete x.kind
                            else x.kind = e.target.value as NodeKind
                          })
                        }
                        className="w-[140px]"
                      >
                        <option value="">Déduit du libellé</option>
                        {NODE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </SelectInput>
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <SelectInput aria-label={`Exécuteur de l’étape ${i + 1}`} value={n.runner} onChange={(e) => patchNode(i, (x) => void (x.runner = e.target.value as Runner))} className="w-[96px]">
                        {RUNNERS.map((r) => (
                          <option key={r} value={r}>
                            {RUNNER_LABEL[r]}
                          </option>
                        ))}
                      </SelectInput>
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <TextInput aria-label={`Fournisseur de l’étape ${i + 1}`} value={n.provider} onChange={(e) => patchNode(i, (x) => void (x.provider = e.target.value))} className="min-w-[170px]" />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <TextInput
                        aria-label={`Crédits de l’étape ${i + 1}`}
                        type="number"
                        min={0}
                        value={n.credits}
                        onChange={(e) => patchNode(i, (x) => void (x.credits = Math.max(0, Number(e.target.value) || 0)))}
                        className="num w-[84px]"
                      />
                    </td>
                    <td className="border-b border-line px-2 py-1.5">
                      <SelectInput aria-label={`Validation de l’étape ${i + 1}`} value={n.validate} onChange={(e) => patchNode(i, (x) => void (x.validate = e.target.value as Validate))} className="w-[112px]">
                        {VALIDATES.map((v) => (
                          <option key={v} value={v}>
                            {VALIDATE_LABEL[v]}
                          </option>
                        ))}
                      </SelectInput>
                    </td>
                    <td className="whitespace-nowrap border-b border-line px-1 py-1.5 text-right">
                      <button type="button" aria-label={`Monter ${n.label}`} disabled={i === 0} onClick={() => patchPipe((p) => void p.nodes.splice(i - 1, 0, ...p.nodes.splice(i, 1)))} className="inline-flex size-8 items-center justify-center rounded-full text-fg-2 hover:bg-hover disabled:opacity-30">
                        <ArrowUp size={14} strokeWidth={1.5} />
                      </button>
                      <button type="button" aria-label={`Descendre ${n.label}`} disabled={i === pipe.nodes.length - 1} onClick={() => patchPipe((p) => void p.nodes.splice(i + 1, 0, ...p.nodes.splice(i, 1)))} className="inline-flex size-8 items-center justify-center rounded-full text-fg-2 hover:bg-hover disabled:opacity-30">
                        <ArrowDown size={14} strokeWidth={1.5} />
                      </button>
                      <button type="button" aria-label={`Supprimer ${n.label}`} disabled={pipe.nodes.length <= 1} onClick={() => patchPipe((p) => void p.nodes.splice(i, 1))} className="inline-flex size-8 items-center justify-center rounded-full text-fg-2 hover:bg-hover disabled:opacity-30">
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {warnings.length > 0 && (
            <ul className="mt-3 flex list-none flex-col gap-1 p-0 text-[12.5px] text-warn" role="status" aria-label="Avertissements">
              {warnings.slice(0, 6).map((w) => (
                <li key={w.path}>{w.message}</li>
              ))}
              {warnings.length > 6 && <li className="text-fg-3">… et {warnings.length - 6} autres étapes sans type</li>}
            </ul>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => patchPipe((p) => void p.nodes.push({ id: `etape-${p.nodes.length + 1}`, label: 'Nouvelle étape', kind: 'code', runner: 'agent', provider: 'Claude Code', credits: 0, validate: 'auto' }))}
          >
            <Plus size={14} strokeWidth={1.75} />
            Ajouter une étape
          </Button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ publish dialog */

function PublishDialog({ published, draft, onClose, onPublish }: { published: Blueprint; draft: Blueprint; onClose: () => void; onPublish: () => void }) {
  const lines = useMemo(() => diffLines(stringify(published), stringify(draft)), [published, draft])
  const view = useMemo(() => collapseDiff(lines, 2), [lines])
  const added = lines.filter((l) => l.kind === 'add').length
  const removed = lines.filter((l) => l.kind === 'del').length
  return (
    <Dialog
      title={`Publier v${draft.version} pour tous les espaces`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={onPublish} disabled={added + removed === 0}>
            {cloudEnabled() ? 'Publier pour tous les espaces' : `Publier pour ${USERS.length} espaces`}
          </Button>
        </>
      }
    >
      <p className="m-0 mb-3 text-[14px] leading-[1.55] text-fg-2">
        Chaque espace de travail reçoit cette version. Les agents et pipelines modifiés à la main par un utilisateur ne sont pas écrasés : ils sont signalés dans son espace.
      </p>
      <p className="num m-0 mb-2 text-[13px] text-fg-3">
        <span className="text-ok">+{added}</span> lignes ajoutées · <span className="text-err">−{removed}</span> lignes retirées
      </p>
      <pre className="m-0 max-h-[360px] overflow-auto rounded-[12px] border border-line-2 bg-surface-1 py-2 font-mono text-[12px] leading-[1.6]" aria-label="Différences avec la version publiée">
        {view.map((l, i) =>
          l.kind === 'gap' ? (
            <div key={i} className="px-3 text-fg-4">
              … {l.hidden} lignes inchangées
            </div>
          ) : (
            <div key={i} className={cx('whitespace-pre px-3', l.kind === 'add' && 'bg-ok-soft text-ok', l.kind === 'del' && 'bg-err-soft text-err', l.kind === 'same' && 'text-fg-3')}>
              {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
              {l.text}
            </div>
          )
        )}
      </pre>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ page */

export function Blueprints() {
  const toast = useToast()
  const [published, setPublished] = useState<Blueprint>(PUBLISHED_V3)
  const [draft, setDraft] = useState<Blueprint>(() => makeDraftV4())
  const [text, setText] = useState(() => stringify(makeDraftV4()))
  const [issues, setIssues] = useState<Issue[]>([])
  const [history, setHistory] = useState<VersionEntry[]>(HISTORY)
  const [view, setView] = useState<View>('form')
  const [section, setSection] = useState<Section>('agents')
  const [publishing, setPublishing] = useState(false)
  const real = cloudEnabled()

  // On Atelier Cloud: the published version and the history are the server's (the first publish starts at v1)
  const fetchServer = (): void => {
    cloudCall<{ current: { version: number; blueprint: Blueprint } | null; versions: { version: number; note: string; publishedBy: string; publishedAt: string }[] }>('/v1/admin/blueprints')
      .then((r) => {
        setHistory(r.versions.map((v) => ({ version: v.version, at: new Date(v.publishedAt).toLocaleString('fr-FR'), by: v.publishedBy, note: v.note || '—' })))
        const base = r.current?.blueprint ?? { ...PUBLISHED_V3, version: 0 }
        setPublished(base)
        load({ ...structuredClone(base), version: base.version + 1 })
      })
      .catch((e: unknown) => toast(`Atelier Cloud ne répond pas : ${e instanceof Error ? e.message : String(e)}`))
  }
  useEffect(() => {
    if (real) fetchServer()
  }, [real])

  const changes = useMemo(() => {
    const d = diffLines(stringify(published), stringify(draft))
    return d.filter((l) => l.kind !== 'same').length
  }, [published, draft])

  const load = (b: Blueprint): void => {
    setDraft(b)
    setText(stringify(b))
    setIssues([])
  }
  const edit = (fn: (b: Blueprint) => void): void => {
    const next = structuredClone(draft)
    fn(next)
    load(next)
  }
  const onText = (value: string): void => {
    setText(value)
    const r = parseBlueprintText(value)
    setIssues(r.issues)
    if (r.value) setDraft(r.value)
  }
  const valid = issues.length === 0

  const publish = (): void => {
    const cleaned = structuredClone(draft)
    cleaned.agents.forEach((a) => void (a.routines = a.routines.filter((r) => r.trim().length > 0)))
    if (real) {
      cloudCall<{ version: number }>('/v1/admin/blueprints', { method: 'POST', body: { blueprint: cleaned, note: `${changes} lignes modifiées` } })
        .then((r) => {
          setPublishing(false)
          toast(`v${r.version} publiée sur Atelier Cloud : les apps la lisent à leur prochaine connexion`)
          fetchServer()
        })
        .catch((e: unknown) => toast(`Publication refusée : ${e instanceof Error ? e.message : String(e)}`))
      return
    }
    setPublished(cleaned)
    setHistory((h) => [{ version: cleaned.version, at: 'à l’instant', by: 'Charlie', note: `${changes} lignes modifiées` }, ...h])
    const nextDraft = { ...structuredClone(cleaned), version: cleaned.version + 1 }
    load(nextDraft)
    setPublishing(false)
    toast(`v${cleaned.version} publiée : ${USERS.length} espaces de travail mis à jour (démo)`)
  }

  const restore = (v: VersionEntry): void => {
    // Demo: the older versions are not stored, so restoring one reloads the published version into the draft.
    load({ ...structuredClone(published), version: published.version + 1 })
    toast(`Brouillon remis sur la version publiée (la v${v.version} n’est pas conservée en démo)`)
  }

  return (
    <>
      <PageHeader
        title="Blueprints"
        sub="L’organisation d’agents et les pipelines préréglés que reçoit chaque nouvel espace de travail. Tu les modifies ici sans toucher au code, puis tu publies une nouvelle version."
        actions={
          <>
            <Segmented<View>
              label="Mode d’édition"
              value={view}
              onChange={setView}
              options={[
                { value: 'form', label: 'Formulaire' },
                { value: 'json', label: 'JSON' }
              ]}
              className="w-[200px]"
            />
            <Button onClick={() => setPublishing(true)} disabled={!valid || changes === 0}>
              {changes === 0 ? 'Aucun changement à publier' : `Publier v${draft.version} pour tous les espaces`}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Panel
          title={`Brouillon v${draft.version}`}
          sub={changes === 0 ? 'Identique à la version publiée.' : `${changes} lignes de différence avec la v${published.version} publiée.`}
          actions={
            view === 'form' ? (
              <Segmented<Section>
                label="Section"
                value={section}
                onChange={setSection}
                options={[
                  { value: 'agents', label: `Agents ${draft.agents.length}` },
                  { value: 'pipelines', label: `Pipelines ${draft.pipelines.length}` }
                ]}
                className="w-[260px]"
              />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => load(draft)} disabled={valid}>
                Revenir au dernier JSON valide
              </Button>
            )
          }
          className="min-w-0"
        >
          {view === 'form' ? (
            section === 'agents' ? (
              <AgentsEditor key="agents" bp={draft} edit={edit} />
            ) : (
              <PipelinesEditor key="pipelines" bp={draft} edit={edit} />
            )
          ) : (
            <div>
              <label htmlFor="bp-json" className="sr-only">
                Blueprint au format JSON
              </label>
              <textarea
                id="bp-json"
                spellCheck={false}
                value={text}
                onChange={(e) => onText(e.target.value)}
                aria-invalid={!valid}
                className={cx(
                  'h-[520px] w-full resize-y rounded-[12px] border bg-surface-1 p-3 font-mono text-[12px] leading-[1.6] text-fg outline-none focus-visible:ring-4 focus-visible:ring-ink/10',
                  valid ? 'border-line-2 focus-visible:border-ink/55' : 'border-err/60'
                )}
              />
              <div className="mt-3 text-[13px]" role="status">
                {valid ? (
                  <Status tone="ok">JSON valide : {draft.agents.length} agents, {draft.pipelines.length} pipelines</Status>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {issues.slice(0, 8).map((i) => (
                      <li key={`${i.path}-${i.message}`} className="flex gap-2 text-err">
                        <span className="font-mono text-[12px]">{i.path}</span>
                        <span>{i.message}</span>
                      </li>
                    ))}
                    {issues.length > 8 && <li className="text-fg-3">… et {issues.length - 8} autres erreurs</li>}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Versions" sub="Chaque publication est conservée" flush className="self-start">
          <ul className="hairline-list m-0 list-none p-0">
            <li className="px-5 py-3 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-fg">v{draft.version}</span>
                <Status tone="warn">Brouillon</Status>
              </div>
              <p className="m-0 mt-0.5 text-fg-3">{changes === 0 ? 'Aucun changement' : `${changes} lignes modifiées, non publié`}</p>
            </li>
            {history.map((h, i) => (
              <li key={h.version} className="px-5 py-3 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg">v{h.version}</span>
                  {i === 0 ? <Status tone="ok">En ligne</Status> : (
                    <Button variant="ghost" size="sm" onClick={() => restore(h)}>
                      Restaurer
                    </Button>
                  )}
                </div>
                <p className="m-0 mt-0.5 text-fg-2">{h.note}</p>
                <p className="m-0 text-[12px] text-fg-3">
                  {h.at} · {h.by}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {publishing && <PublishDialog published={published} draft={draft} onClose={() => setPublishing(false)} onPublish={publish} />}
    </>
  )
}
