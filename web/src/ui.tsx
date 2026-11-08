import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from './router'
import { useTheme } from './theme'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Brand mark: a small ink tile with an A drawn in the negative space. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path d="M9 23 16 8l7 15M12 18.5h8" fill="none" stroke="var(--ink-fg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium select-none transition-[background-color,color,border-color,transform] duration-100 ease-out active:scale-[.98] disabled:pointer-events-none disabled:opacity-40'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-ink-fg hover:bg-ink/88',
  secondary: 'border border-line-2 bg-surface-1 text-fg hover:border-line-3 hover:bg-hover',
  ghost: 'text-fg-2 hover:bg-hover hover:text-fg'
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[13px]',
  md: 'h-9 px-4 text-[14px]',
  lg: 'h-11 px-5 text-[15px]'
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], extra)
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />
}

export function LinkButton({
  to,
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: { to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  )
}

/** Pill segmented control with a sliding indicator; segments have equal widths. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
  className?: string
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx('relative inline-grid h-9 items-center rounded-full bg-surface-2 p-0.5', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 rounded-full bg-surface-pop shadow-[0_0_0_1px_var(--line-2)] transition-transform duration-[240ms] ease-[var(--ease-out)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative z-10 h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors',
            o.value === value ? 'text-fg' : 'text-fg-3 hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Container({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} className={cx('mx-auto w-full max-w-[1200px] px-5 sm:px-8', className)}>
      {children}
    </div>
  )
}

export function Dot({ tone = 'ok', pulse = false }: { tone?: 'ok' | 'warn' | 'err' | 'info' | 'idle'; pulse?: boolean }) {
  const color = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', info: 'bg-info', idle: 'bg-fg-4' }[tone]
  return <span aria-hidden="true" className={cx('inline-block size-1.5 shrink-0 rounded-full', color, pulse && 'ring-run')} />
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-fg-2', className)}>
      {children}
    </span>
  )
}

export interface Crop {
  /** Left and top of the visible region, and its width, as fractions of the 1440 x 900 screenshot. The height follows the frame's aspect. */
  x: number
  y: number
  w: number
}

/**
 * A real product screenshot in a rounded frame. Files are looked up by stable name in /shots/<name>-<theme>.png and
 * swap with the visitor's theme; a missing file shows a neutral frame carrying the screen's name.
 * `aspect` is the frame's width / height; `crop` zooms on a region of the screenshot (default: all of it).
 */
export function ShotFrame({
  name,
  alt,
  className,
  eager = false,
  radius = 20,
  aspect = 1440 / 900,
  crop = { x: 0, y: 0, w: 1 }
}: {
  name: string
  alt: string
  className?: string
  eager?: boolean
  radius?: number
  aspect?: number
  crop?: Crop
}) {
  const { theme } = useTheme()
  const [missing, setMissing] = useState<string | null>(null)
  const src = `${import.meta.env.BASE_URL}shots/${name}-${theme}.png`
  const failed = missing === src
  // The image is scaled so that the crop's width fills the frame, then shifted; top is a % of the frame's height.
  const imgStyle = {
    position: 'absolute' as const,
    maxWidth: 'none',
    width: `${100 / crop.w}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${-((crop.y * aspect * 0.625) / crop.w) * 100}%`
  }
  return (
    <figure
      className={cx('relative m-0 overflow-hidden border border-line-2 bg-surface-1', className)}
      style={{ borderRadius: radius, aspectRatio: String(aspect), boxShadow: 'var(--frame-shadow)' }}
    >
      {failed ? (
        <div className="grid h-full w-full place-items-center bg-surface-2 text-center">
          <div>
            <p className="m-0 text-[15px] font-medium text-fg">{name}</p>
            <p className="m-0 mt-1 text-[13px] text-fg-3">{alt}</p>
          </div>
        </div>
      ) : (
        <img
          key={src}
          src={src}
          alt={alt}
          width={1440}
          height={900}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className="block h-auto"
          style={imgStyle}
          onError={() => setMissing(src)}
        />
      )}
    </figure>
  )
}
