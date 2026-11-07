// shadcn/ui Command (MIT, https://github.com/shadcn-ui/ui) on cmdk, restyled with Atelier's tokens. See VENDOR.md.
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-modal bg-surface-pop text-fg', className)}
      {...props}
    />
  )
}

/** The palette as a modal: a Radix dialog around a cmdk list. */
export function CommandDialog({
  title,
  open,
  onOpenChange,
  children
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-testid="palette"
          aria-describedby={undefined}
          className="no-drag fixed top-[16vh] left-1/2 z-50 w-[min(600px,92vw)] -translate-x-1/2 overflow-hidden rounded-modal border border-line-2 bg-surface-pop shadow-[var(--shadow-modal)] outline-none data-[state=open]:animate-[fade-in_200ms_var(--ease-out)]"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4" data-slot="command-input-wrapper">
      <Search className="size-4 shrink-0 text-fg-3" aria-hidden />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-12 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-3 disabled:opacity-50',
          className
        )}
        {...props}
      />
    </div>
  )
}

export function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn('max-h-[360px] overflow-x-hidden overflow-y-auto p-2', className)} {...props} />
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-8 text-center text-[13px] text-fg-3" {...props} />
}

export function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'text-fg-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[1.2px] [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:uppercase',
        className
      )}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-field px-3 py-2 text-[13px] outline-none select-none data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-3",
        className
      )}
      {...props}
    />
  )
}
