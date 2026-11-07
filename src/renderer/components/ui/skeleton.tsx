// shadcn/ui Skeleton (MIT, https://github.com/shadcn-ui/ui), restyled with Atelier's tokens. See VENDOR.md.
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-field bg-surface-2', className)} {...props} />
}
