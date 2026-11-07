// « Traduire » (clonage-traduction): the same pipeline in another language, saved as a new pipeline of the team. The script, the cards'
// texts (numbers and currencies in that language) and the archives' captions follow the language; the voice is the channel's.
import { Languages } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { RecipeDetail } from '../../../../shared/recipes'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'

const LANGUAGES = ['fr', 'en', 'es', 'de', 'pt', 'it'] as const

export function TranslateRecipe({ recipeId, current, onDone }: { recipeId: number; current: string | null; onDone: (d: RecipeDetail) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const go = async (language: string): Promise<void> => {
    setBusy(true)
    try {
      const d = await call('recipes.translate', recipeId, language)
      toast.success(t('recipeEd.translated', { name: d.name }))
      setOpen(false)
      onDone(d)
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="relative inline-flex items-center gap-2">
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-fg-2 ring-1 ring-line" data-testid="recipe-language">
        {current ? t(`pstyle.language.${current}` as MessageKey) : t('recipeEd.language.channel')}
      </span>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => setOpen((o) => !o)} data-testid="recipe-translate">
        <Languages />
        {t('recipeEd.translate')}
      </Button>
      {open && (
        <span className="absolute right-0 top-full z-50 mt-1 flex min-w-[160px] flex-col rounded-field bg-surface p-1 shadow-lg ring-1 ring-line" role="menu">
          {LANGUAGES.filter((l) => l !== current).map((l) => (
            <button key={l} type="button" role="menuitem" className="rounded px-3 py-1.5 text-left text-[12.5px] text-fg hover:bg-surface-2" onClick={() => void go(l)} data-testid={`recipe-translate-${l}`}>
              {t(`pstyle.language.${l}` as MessageKey)}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
