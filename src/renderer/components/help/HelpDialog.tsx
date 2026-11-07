// « Aide »: the keyboard shortcuts. (The guided-tour video of the first app was dropped from this repository: too
// heavy and out of date; the screens are listed in docs/ECRANS.md.)
import { enPHelp } from '../../../shared/en-p-help'
import { getLocale } from '../../../shared/fr'
import { frPHelp, type HelpKey } from '../../../shared/fr-p-help'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Local dictionary until frPHelp / enPHelp are registered in fr-proto.ts / en.ts (then `t()` can replace this). */
function ht(key: HelpKey, vars?: Record<string, string | number>): string {
  const raw: string = (getLocale() === 'en' ? enPHelp[key] : undefined) ?? frPHelp[key]
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

const SHORTCUTS: ReadonlyArray<{ keys: string; label: HelpKey }> = [
  { keys: 'Ctrl K', label: 'help.shortcut.search' },
  { keys: 'Ctrl B', label: 'help.shortcut.sidebar' },
  { keys: 'Ctrl J', label: 'help.shortcut.atlas' }
]

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={ht('help.close')}
        data-testid="help-dialog"
        className="max-h-[92vh] w-[min(560px,94vw)] gap-5 overflow-y-auto p-6"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{ht('help.title')}</DialogTitle>
          <DialogDescription>{ht('help.description')}</DialogDescription>
        </DialogHeader>

        <section aria-label={ht('help.shortcuts')} className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-fg-3">{ht('help.shortcuts')}</h3>
          <ul className="flex flex-wrap gap-x-8 gap-y-2">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center gap-2 text-[13px] text-fg-2">
                <span className="kbd">{s.keys}</span>
                {ht(s.label)}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-fg-3">
            {ht('help.shortcut.hint')}
          </p>
        </section>
      </DialogContent>
    </Dialog>
  )
}
