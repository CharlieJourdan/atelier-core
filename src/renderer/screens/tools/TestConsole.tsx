// Mes outils › test console. The backend does a DRY RUN: it checks the inputs, the permissions and the secrets, renders
// exactly what would be launched and records the run. Nothing is executed (real execution comes with lot 18); the screen
// says so plainly.
import { CircleAlert, CircleCheck, FlaskConical, Play } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { DryRunResult, RenderedCall, ToolDetail, ToolParam, ToolRunRow } from '../../../shared/tools'
import { ErrorLine, ExampleBadge, Field, fmtDate, LoadingBlock } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { call, errText, useLoader } from '@/state/client'
import { jsonText } from './common'

export function renderedLines(c: RenderedCall): string[] {
  if (c.kind === 'command') return [c.line, `stdin ← ${c.stdin}`]
  if (c.kind === 'http') return [`${c.method} ${c.url}`, ...Object.entries(c.headers).map(([k, v]) => `${k}: ${v}`), ...(c.body ? [c.body] : [])]
  return [`${c.transport} · ${c.target}`, `${c.tool}(${JSON.stringify(c.arguments)})`]
}

const LONG_TEXT = /script|texte|text|prompt|body|contenu/i

function InputField({ param, value, onChange }: { param: ToolParam; value: string; onChange: (v: string) => void }) {
  const id = `tool-in-${param.name}`
  const hint = [param.description, param.default !== undefined ? t('tools.test.default', { value: String(param.default) }) : ''].filter(Boolean).join(' · ')
  const label = `${param.name}${param.required ? ' *' : ''}`
  const multiline = param.type === 'json' || (param.type === 'string' && LONG_TEXT.test(param.name))
  return (
    <Field label={label} htmlFor={id} hint={hint || undefined}>
      {param.type === 'boolean' ? (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('tools.test.unset')}</option>
          <option value="true">{t('tools.test.true')}</option>
          <option value="false">{t('tools.test.false')}</option>
        </Select>
      ) : multiline ? (
        <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={param.type === 'json' ? 'font-mono text-[12px]' : undefined} />
      ) : (
        <Input id={id} inputMode={param.type === 'number' ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  )
}

export function ResultView({ result }: { result: DryRunResult }) {
  return (
    <div className="flex flex-col gap-3" data-testid="dry-run-result">
      <p className={`flex items-center gap-2 text-[13px] ${result.ok ? 'text-ok' : 'text-warn'}`}>
        {result.ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
        {result.ok ? t('tools.test.allOk') : t('tools.test.notReady')}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {result.checks.map((c) => (
          <li key={c.id} data-check={c.id} data-ok={c.ok} className="flex items-start gap-2 text-[12.5px]">
            {c.ok ? (
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-label={t('tools.test.pass')} />
            ) : (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-label={t('tools.test.fail')} />
            )}
            <span className="text-fg-2">
              {t(`tools.check.${c.id}` as MessageKey)}
              {c.items.length > 0 && <span className="block text-fg-3">{c.items.join(' · ')}</span>}
            </span>
          </li>
        ))}
      </ul>
      {result.rendered && (
        <div>
          <h4 className="micro-label mb-1.5">{t('tools.test.rendered')}</h4>
          <pre data-testid="rendered-call" className="overflow-auto rounded-field border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap text-fg-2">
            {renderedLines(result.rendered).join('\n')}
          </pre>
        </div>
      )}
    </div>
  )
}

const RUN_TONE = { ok: 'ok', error: 'err', dry_run: 'default' } as const

export function RunHistory({ runs }: { runs: readonly ToolRunRow[] }) {
  if (runs.length === 0) return <p className="text-[13px] text-fg-3">{t('tools.history.empty')}</p>
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" data-testid="tool-runs">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-fg-3">
            <Badge variant={RUN_TONE[r.status]}>{t(`tools.history.status.${r.status}` as MessageKey)}</Badge>
            <span>{fmtDate(r.createdAt, true)}</span>
            <span className="tabular-nums">{t('tools.history.ms', { ms: r.ms })}</span>
            {r.example && <ExampleBadge />}
          </div>
          <code className="line-clamp-2 font-mono text-[11.5px] break-all text-fg-2">{jsonText(r.input).replace(/\s+/g, ' ')}</code>
          {r.outputText && <pre className="m-0 max-h-28 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap text-fg-3">{r.outputText}</pre>}
        </li>
      ))}
    </ul>
  )
}

export function TestConsole({ tool }: { tool: ToolDetail }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<DryRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const runs = useLoader(() => call('tools.runs', tool.slug), `runs:${tool.slug}`, ['tools'])

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const input = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''))
      setResult(await call('tools.dryRun', tool.slug, input))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('tools.test.title')}>
        <p className="mb-4 flex items-start gap-2 text-[12.5px] text-fg-3" role="note">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('tools.test.dryNote')}
        </p>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          {tool.manifest.inputs.length === 0 ? (
            <p className="text-[13px] text-fg-3">{t('tools.test.noInputs')}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {tool.manifest.inputs.map((p) => (
                <InputField key={p.name} param={p} value={values[p.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))} />
              ))}
            </div>
          )}
          <div>
            <Button type="submit" disabled={busy}>
              <Play /> {t('tools.test.run')}
            </Button>
          </div>
        </form>
        {error && <ErrorLine message={error} />}
        {result && (
          <div className="mt-4 border-t border-line pt-4">
            <ResultView result={result} />
          </div>
        )}
      </Panel>
      <Panel title={t('tools.history.title')}>
        {runs.error ? <ErrorLine message={runs.error} onRetry={runs.reload} /> : !runs.data ? <LoadingBlock rows={2} /> : <RunHistory runs={runs.data} />}
      </Panel>
    </div>
  )
}
