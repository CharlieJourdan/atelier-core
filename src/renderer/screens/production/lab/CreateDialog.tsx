// « Créer une pipeline » (production-lab, Charlie 01/11: « quand on met Créer une pipeline, ça va nous donner le choix… une
// interface qui ressort »; parcours-utilisateur 02/11): the seven ways in of the style agent (screen `production/style`, opened on
// the chosen one: clone, import my channel, translate, a little different, mix two channels, create from scratch with inspirations,
// rework one of my pipelines), one of my channels already in Atelier (the pipeline agent, `production/agent`), or a code someone
// shared (pasted, imported, then opened on the agent to change it; built but off in the beta, `ATELIER_PIPELINE_CODES=1`). The
// format (long or Short) follows the references: no format to pick first.
import { ArrowRight, Hash, Tv } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { StudyPath } from '../../../../shared/style-agent'
import type { Route } from '../../../../shared/sections'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'
import { openRecipeNext } from '../recettes/selection'
import { PATH_ORDER } from '../style/PathForm'
import { openStudyNext } from '../style/path-next'

function Way({ icon, title, hint, onClick, testId, disabled = false, badge }: { icon: ReactNode; title: string; hint: string; onClick: () => void; testId: string; disabled?: boolean; badge?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="group flex w-full items-center gap-3.5 rounded-[14px] border border-line-2 bg-surface-1 p-4 text-left transition-[background-color,border-color] duration-150 hover:border-brand-line hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-55"
    >
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-3 text-fg-2 group-hover:bg-brand group-hover:text-brand-ink">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          {title}
          {badge && <span className="rounded-full border border-line-3 px-1.5 py-px text-[10px] font-medium text-fg-3">{badge}</span>}
        </span>
        <span className="text-[12.5px] leading-[1.45] text-fg-3">{hint}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
    </button>
  )
}

export function CreateDialog({ open, onOpenChange, onRoute, codes }: { open: boolean; onOpenChange: (o: boolean) => void; onRoute: (r: Route) => void; codes: boolean }) {
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const path = (p: StudyPath): void => {
    openStudyNext(p)
    go('style')
  }
  const go = (page: string): void => {
    onOpenChange(false)
    onRoute({ section: 'production', page })
  }
  const importCode = async (): Promise<void> => {
    setBusy(true)
    try {
      const d = await call('recipes.fromCode', text)
      toast.success(t('lab.code.done', { name: d.name }))
      onOpenChange(false)
      openRecipeNext(d.id, { agent: true })
      onRoute({ section: 'production', page: 'pipeline' })
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setPasting(false)
      }}
    >
      <DialogContent className="w-[min(640px,94vw)] gap-5 p-7" data-testid="create-dialog">
        <DialogHeader>
          <DialogTitle className="text-[24px] tracking-[-0.02em]">{t('lab.create')}</DialogTitle>
          <DialogDescription>{t('lab.createDlg.body')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-testid="create-paths">
          {PATH_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => path(p)}
              data-testid={p === 'clone' ? 'create-from-style' : `create-path-${p}`}
              className="group flex items-start gap-2 rounded-[12px] border border-line-2 bg-surface-1 px-3 py-2.5 text-left transition-colors hover:border-brand-line hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-fg">{t(`ppath.${p}` as MessageKey)}</span>
                <span className="text-[11.5px] leading-[1.4] text-fg-3">{t(`ppath.${p}.hint` as MessageKey)}</span>
              </span>
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-fg-4 group-hover:text-fg" aria-hidden />
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <Way icon={<Tv className="size-[18px]" />} title={t('lab.from.channel')} hint={t('lab.from.channel.hint')} onClick={() => go('agent')} testId="agent-recipe" />
          <Way
            icon={<Hash className="size-[18px]" />}
            title={t('lab.from.code')}
            hint={t('lab.from.code.hint')}
            onClick={() => setPasting(true)}
            testId="create-from-code"
            disabled={!codes}
            badge={codes ? undefined : t('lab.from.code.soon')}
          />
          {codes && pasting && (
            <div className="flex flex-col gap-2" data-testid="code-paste">
              <Textarea rows={3} autoFocus value={text} placeholder={t('lab.code.placeholder')} onChange={(e) => setText(e.target.value)} className="font-mono text-[12px]" data-testid="code-input" />
              <Button className="self-end" disabled={busy || !text.trim()} onClick={() => void importCode()} data-testid="code-import">
                {t('lab.code.go')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
