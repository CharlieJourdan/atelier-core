// shadcn/ui Badge (MIT, https://github.com/shadcn-ui/ui), restyled with Atelier's tokens. See VENDOR.md.
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-line-2 bg-surface-2 text-fg-2',
        brand: 'border-brand-line bg-brand-soft text-brand-fg',
        ok: 'border-brand-line bg-ok-soft text-ok',
        warn: 'border-warn/30 bg-warn/10 text-warn',
        err: 'border-err/30 bg-err/10 text-err',
        outline: 'border-line-3 bg-transparent text-fg-2'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
