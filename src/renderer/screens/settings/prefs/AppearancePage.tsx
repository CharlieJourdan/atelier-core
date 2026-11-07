// Réglages › Apparence: dark or light, through the app's theme mechanism (lib/theme: data-theme, remembered, and the
// native window follows through `app.setTheme`).
import { Moon, Sun } from 'lucide-react'
import { t } from '../../../../shared/fr'
import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { ScreenProps } from '../../registry'
import { PrefsPage } from './common'

const OPTIONS = [
  { id: 'dark', icon: Moon, label: 'prefs.apparence.dark', hint: 'prefs.apparence.dark.hint' },
  { id: 'light', icon: Sun, label: 'prefs.apparence.light', hint: 'prefs.apparence.light.hint' }
] as const

export function AppearanceBody({ theme, onPick }: { theme: Theme; onPick: (t: Theme) => void }) {
  return (
    <div role="radiogroup" aria-label={t('prefs.apparence.current')} className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map(({ id, icon: Icon, label, hint }) => {
        const active = theme === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            data-theme-option={id}
            onClick={() => onPick(id)}
            className={cn(
              'flex flex-col gap-3 rounded-card border bg-surface-1 p-4 text-left transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/60',
              active ? 'border-brand/70' : 'border-line'
            )}
          >
            <span
              aria-hidden
              className={cn('flex h-24 items-end gap-2 rounded-field border p-3', id === 'dark' ? 'border-white/10 bg-[#0f1013]' : 'border-black/10 bg-[#f6f5f2]')}
            >
              <span className={cn('h-2 w-10 rounded-full', id === 'dark' ? 'bg-white/70' : 'bg-black/70')} />
              <span className="h-2 w-6 rounded-full bg-[#8b7cff]" />
              <span className={cn('h-2 w-4 rounded-full', id === 'dark' ? 'bg-white/20' : 'bg-black/20')} />
            </span>
            <span className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
              <Icon className="size-4" aria-hidden /> {t(label)}
            </span>
            <span className="text-[12px] text-fg-3">{t(hint)}</span>
          </button>
        )
      })}
    </div>
  )
}

export function AppearancePage(_props: ScreenProps) {
  const { theme, setTheme } = useTheme()
  return (
    <PrefsPage page="apparence">
      <AppearanceBody theme={theme} onPick={setTheme} />
    </PrefsPage>
  )
}
