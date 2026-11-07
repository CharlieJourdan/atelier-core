import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// Atelier addition (not upstream): code-splits three.js / react-three-fiber behind React.lazy.
// All app code must import LazyOrb, never ./orb directly.
const Orb = lazy(() => import('./orb').then((m) => ({ default: m.Orb })))

export type LazyOrbProps = ComponentProps<typeof Orb>

/** Cheap CSS stand-in shown while the WebGL chunk loads. */
export function OrbFallback({ colors = ['#CADCFC', '#A0B9D1'], className }: Pick<LazyOrbProps, 'colors' | 'className'>) {
  return (
    <div
      data-slot="orb-fallback"
      className={cn('relative size-full', className)}
    >
      <div
        className="absolute inset-[8%] rounded-full opacity-90 blur-[1px]"
        style={{ background: `radial-gradient(circle at 35% 30%, ${colors[0]}, ${colors[1]})` }}
      />
    </div>
  )
}

export function LazyOrb(props: LazyOrbProps) {
  return (
    <Suspense fallback={<OrbFallback colors={props.colors} className={props.className} />}>
      <Orb {...props} />
    </Suspense>
  )
}
