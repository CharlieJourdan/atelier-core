// shadcn/ui Tabs (MIT, https://github.com/shadcn-ui/ui) on Radix, in the segmented-pill look. See VENDOR.md.
import { Tabs as TabsPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-7 items-center justify-center rounded-full px-3 text-xs font-medium whitespace-nowrap text-fg-3 transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-brand/70 hover:text-fg data-[state=active]:bg-surface-pop data-[state=active]:text-fg data-[state=active]:shadow-[var(--shadow-1)] data-[state=active]:ring-1 data-[state=active]:ring-line-2',
        className
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />
}
