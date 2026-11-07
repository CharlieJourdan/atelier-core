// shadcn/ui Dialog (MIT, https://github.com/shadcn-ui/ui) on Radix, restyled with Atelier's tokens. See VENDOR.md.
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  closeLabel = 'Fermer',
  hideClose = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string; hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-sm data-[state=open]:animate-[fade-in_200ms_var(--ease-out)]" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'no-drag fixed top-1/2 left-1/2 z-50 grid w-[min(480px,92vw)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-modal border border-line-2 bg-surface-pop p-6 text-fg shadow-[var(--shadow-modal)] outline-none data-[state=open]:animate-[fade-in_200ms_var(--ease-out)]',
          className
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute top-4 right-4 rounded-full p-1 text-fg-3 transition-colors duration-150 hover:bg-hover hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2', className)} {...props} />
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('font-serif text-2xl leading-tight', className)} {...props} />
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-[13px] text-fg-3', className)} {...props} />
}
