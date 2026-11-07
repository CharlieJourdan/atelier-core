// Form controls in the shadcn style (MIT pattern, own code), on Atelier's tokens: Input, Textarea, Select (native),
// Switch (a button with role="switch") and Label. Native elements on purpose: no runtime <style> injection (strict CSP).
import type * as React from 'react'
import { cn } from '@/lib/utils'

const field =
  'w-full rounded-field border border-line-2 bg-surface-2 px-3 text-[13px] text-fg outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-fg-3 hover:border-line-3 focus-visible:border-brand-line focus-visible:bg-surface-1 focus-visible:ring-4 focus-visible:ring-brand-soft disabled:opacity-50'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(field, 'h-9', className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(field, 'min-h-20 py-2 leading-[1.45]', className)} {...props} />
}

export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select data-slot="select" className={cn(field, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  )
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('text-[12px] font-medium text-fg-2', className)} {...props} />
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onChange'> & { checked: boolean; onCheckedChange?: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-state={checked ? 'on' : 'off'}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line-2 transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-45',
        checked ? 'border-transparent bg-brand' : 'bg-surface-3',
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-3.5 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-200',
          checked ? 'translate-x-[18px] bg-white' : 'translate-x-[2px] bg-fg-3'
        )}
      />
    </button>
  )
}
