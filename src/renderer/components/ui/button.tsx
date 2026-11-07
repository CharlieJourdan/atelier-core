// shadcn/ui Button (MIT, https://github.com/shadcn-ui/ui), restyled with Atelier's tokens. See VENDOR.md.
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// A disabled green button turns grey (Apple) instead of a washed-out green.
const QUIET_DISABLED = 'disabled:bg-surface-3 disabled:text-fg-3 disabled:shadow-none disabled:opacity-100'

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,opacity,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `bg-brand text-brand-ink shadow-[var(--shadow-1)] hover:bg-brand/90 ${QUIET_DISABLED}`,
        neutral: 'bg-ink text-ink-fg hover:opacity-90',
        brand: `bg-brand text-brand-ink shadow-[var(--shadow-1)] hover:bg-brand/90 ${QUIET_DISABLED}`,
        secondary: 'bg-surface-1 text-fg border border-line-2 shadow-[var(--shadow-1)] hover:bg-surface-2',
        outline: 'border border-line-2 bg-transparent text-fg hover:border-line-3 hover:bg-hover',
        ghost: 'bg-transparent text-fg-2 hover:bg-hover hover:text-fg',
        destructive: 'bg-err text-white hover:opacity-90',
        link: 'text-brand-fg underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-8'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
