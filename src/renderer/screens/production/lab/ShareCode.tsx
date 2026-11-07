// A pipeline's code on its page (production-lab): `Code 7K2Q-9XPM` and « Partager », a dialog with the text that carries the
// whole pipeline and « Copier ». Shown only while pipeline codes are on (built, off in the beta: `ATELIER_PIPELINE_CODES=1`).
import { Copy, Share2 } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'

export function ShareCode({ recipeId, name, code }: { recipeId: number; name: string; code: string }) {
  const [text, setText] = useState<string | null>(null)
  const open = async (): Promise<void> => {
    try {
      setText((await call('recipes.share', recipeId)).text)
    } catch (e) {
      toast.error(errText(e))
    }
  }
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text ?? '')
      toast.success(t('lab.code.copied'))
    } catch (e) {
      toast.error(errText(e))
    }
  }
  return (
    <>
      <span className="num inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 px-3 text-[12px] text-fg-2" data-testid="recipe-code">
        <span className="text-fg-3">{t('lab.code.label')}</span>
        <span className="font-mono font-medium text-fg">{code}</span>
      </span>
      <Button variant="secondary" size="sm" onClick={() => void open()} data-testid="recipe-share">
        <Share2 />
        {t('lab.code.share')}
      </Button>
      <Dialog open={text !== null} onOpenChange={(o) => !o && setText(null)}>
        <DialogContent className="w-[min(560px,94vw)]" data-testid="share-dialog">
          <DialogHeader>
            <DialogTitle className="text-[20px]">{t('lab.code.shareTitle', { name })}</DialogTitle>
            <DialogDescription>{t('lab.code.shareBody')}</DialogDescription>
          </DialogHeader>
          <Textarea readOnly rows={5} value={text ?? ''} className="font-mono text-[11.5px]" data-testid="share-text" onFocus={(e) => e.currentTarget.select()} />
          <Button className="self-end" onClick={() => void copy()}>
            <Copy />
            {t('lab.code.copy')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
