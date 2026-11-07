// Confirmation modal (replaces the native confirm(), which the app never uses). The dangerous action sits on the left.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface ConfirmOptions {
  title: string
  description?: string
  /** Label of the main action. */
  confirmLabel?: string
  cancelLabel?: string
  /** Red, left-hand action (deleting, abandoning…). */
  danger?: boolean
}

/** The visual content of the modal, kept apart from Radix so it can be rendered and tested on its own. */
export function ConfirmBody({
  options,
  onResolve,
  standalone = false
}: {
  options: ConfirmOptions
  onResolve: (ok: boolean) => void
  /** Rendered outside a Radix dialog (gallery, tests): plain heading and text instead of DialogTitle. */
  standalone?: boolean
}) {
  const Title = standalone ? 'h2' : DialogTitle
  const Description = standalone ? 'p' : DialogDescription
  const confirm = (
    <Button
      key="confirm"
      variant={options.danger ? 'destructive' : 'default'}
      data-testid="confirm-ok"
      onClick={() => onResolve(true)}
    >
      {options.confirmLabel ?? t('confirm.confirm')}
    </Button>
  )
  const cancel = (
    <Button key="cancel" variant="ghost" data-testid="confirm-cancel" onClick={() => onResolve(false)}>
      {options.cancelLabel ?? t('confirm.cancel')}
    </Button>
  )
  return (
    <>
      <DialogHeader>
        <Title className="font-serif text-2xl leading-tight">{options.title}</Title>
        {options.description && <Description className="text-[13px] text-fg-3">{options.description}</Description>}
      </DialogHeader>
      <DialogFooter className={options.danger ? 'justify-between' : 'justify-end'}>
        {options.danger ? [confirm, cancel] : [cancel, confirm]}
      </DialogFooter>
    </>
  )
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask>(() => Promise.resolve(false))

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOptions(null)
  }, [])

  const ask = useCallback<Ask>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        setOptions(o)
      }),
    []
  )
  const value = useMemo(() => ask, [ask])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={options !== null} onOpenChange={(open) => !open && finish(false)}>
        <DialogContent
          hideClose
          data-testid="confirm-dialog"
          // Never land on the destructive action: focus Cancel, so a stray Enter cannot confirm.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-testid="confirm-cancel"]')?.focus()
          }}
        >
          {options && <ConfirmBody options={options} onResolve={finish} />}
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

/** `const confirm = useConfirm(); if (await confirm({ title: '…', danger: true })) …` */
export function useConfirm(): Ask {
  return useContext(ConfirmContext)
}
