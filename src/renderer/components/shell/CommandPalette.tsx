// ⌘K / Ctrl+K palette: navigation, pages and a few actions. Search inside videos, conversations and tools comes with
// the lots that own that data.
import { Palette } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { t } from '../../../shared/fr'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { SectionIcon } from './icons'
import type { Command as Cmd } from './commands'

export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)
}

/** The palette body (without the modal), reusable in the gallery and in tests. */
export function PaletteList({ commands, onRun }: { commands: Cmd[]; onRun: (c: Cmd) => void }) {
  const groups = useMemo(
    () =>
      (['navigation', 'actions', 'pages'] as const).map((g) => ({
        group: g,
        items: commands.filter((c) => c.group === g)
      })),
    [commands]
  )
  return (
    <Command loop>
      <CommandInput placeholder={t('palette.placeholder')} data-testid="palette-input" />
      <CommandList>
        <CommandEmpty>{t('palette.empty')}</CommandEmpty>
        {groups.map(({ group, items }) => (
          <CommandGroup key={group} heading={t(`palette.group.${group}`)}>
            {items.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.label} ${(c.keywords ?? []).join(' ')}`}
                data-testid={`cmd-${c.id}`}
                onSelect={() => onRun(c)}
              >
                {c.section ? <SectionIcon section={c.section} className="size-4" /> : <Palette aria-hidden />}
                {c.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}

export function CommandPalette({
  open,
  onOpenChange,
  commands
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Cmd[]
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isPaletteShortcut(e)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <CommandDialog title={t('palette.title')} open={open} onOpenChange={onOpenChange}>
      <PaletteList
        commands={commands}
        onRun={(c) => {
          onOpenChange(false)
          c.run()
        }}
      />
    </CommandDialog>
  )
}
