// The before / after of an option (pipeline-ui, Charlie 01/11: « quand il est marqué chapitre à l'écran, je ne sais pas à quoi
// ça ressemble… mettre différence avant / après »): two 3-second loops of the same moment of a video, rendered once by the
// engine on the fakes (`npm run previews:options`, resources/option-previews) and shown free. Music keeps its sound (played
// on demand, with controls).
import { Eye } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { OPTION_PREVIEWS, optionPreviewKey } from '../../../../shared/option-previews'
import type { PreviewItem } from '../../../../shared/previews'
import type { OptionInfo } from '../../../../shared/recipes'
import { call } from '@/state/client'
import { PreviewMedia } from '../style/Previews'

let cache: Promise<PreviewItem[]> | null = null

/** The saved before / after previews, by key (read once per window). */
export function useOptionPreviews(): Map<string, PreviewItem> {
  const [items, setItems] = useState<Map<string, PreviewItem>>(new Map())
  useEffect(() => {
    let live = true
    cache ??= call('previews.options').catch(() => [])
    void cache.then((list) => live && setItems(new Map(list.map((i) => [i.key, i]))))
    return () => {
      live = false
    }
  }, [])
  return items
}

/** « Avant / après » under an option: a small toggle that opens the two loops side by side. */
export function OptionPreview({ option, previews }: { option: OptionInfo; previews: Map<string, PreviewItem> }) {
  const [open, setOpen] = useState(false)
  const spec = OPTION_PREVIEWS.find((p) => p.option === option.id)
  if (!spec) return null
  const sides = (['before', 'after'] as const).map((side) => {
    const value = spec[side]
    return { side, value, item: previews.get(optionPreviewKey(option.id, value)), choice: option.choices.find((c) => c.value === value) }
  })
  if (sides.some((s) => !s.item)) return null
  return (
    <div className="flex flex-col gap-2" data-testid={`opt-preview-${option.id}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={`opt-preview-toggle-${option.id}`}
        className="inline-flex items-center gap-1.5 self-start rounded-full text-[11.5px] text-fg-3 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Eye className="size-3.5" aria-hidden />
        {t(open ? 'pipe.preview.hide' : 'pipe.preview.show')}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2">
          {sides.map(({ side, item, choice }) => (
            <figure key={side} className="flex flex-col gap-1" data-testid={`opt-preview-${option.id}-${side}`}>
              {item?.files[0] && <PreviewMedia item={item} file={item.files[0]} sound={spec.sound} />}
              <figcaption className="text-[11px] text-fg-3">
                <span className="font-medium text-fg-2">{t(`pipe.preview.${side}`)}</span>
                {choice && ` · ${t(choice.labelKey as MessageKey)}`}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
