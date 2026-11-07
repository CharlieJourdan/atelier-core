// Vendored from elevenlabs/ui (MIT) – see VENDOR.md and ./LICENSE. Modified for Atelier: no "use client"; the `motion` dependency (not installed) replaced by IntersectionObserver + Web Animations API.
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

interface ShimmeringTextProps {
  /** Text to display with shimmer effect */
  text: string
  /** Animation duration in seconds */
  duration?: number
  /** Delay before starting animation */
  delay?: number
  /** Whether to repeat the animation */
  repeat?: boolean
  /** Pause duration between repeats in seconds */
  repeatDelay?: number
  /** Custom className */
  className?: string
  /** Whether to start animation when component enters viewport */
  startOnView?: boolean
  /** Whether to animate only once */
  once?: boolean
  /** Margin for in-view detection (rootMargin) */
  inViewMargin?: string
  /** Shimmer spread multiplier */
  spread?: number
  /** Base text color */
  color?: string
  /** Shimmer gradient color */
  shimmerColor?: string
}

export function ShimmeringText({
  text,
  duration = 2,
  delay = 0,
  repeat = true,
  repeatDelay = 0.5,
  className,
  startOnView = true,
  once = false,
  inViewMargin,
  spread = 2,
  color,
  shimmerColor,
}: ShimmeringTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isInView, setIsInView] = useState(() => typeof IntersectionObserver === "undefined")

  // Calculate dynamic spread based on text length
  const dynamicSpread = useMemo(() => {
    return text.length * spread
  }, [text, spread])

  // Replaces motion's useInView with a plain IntersectionObserver.
  useEffect(() => {
    const el = ref.current
    if (!el || !startOnView) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          setIsInView(true)
          if (once) observer.disconnect()
        } else if (!once) {
          setIsInView(false)
        }
      },
      { rootMargin: inViewMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [startOnView, once, inViewMargin])

  const shouldAnimate = !startOnView || isInView

  // Replaces motion's animate/transition with the Web Animations API (same keyframes and timing).
  useEffect(() => {
    const el = ref.current
    if (!el || !shouldAnimate || typeof el.animate !== "function") return
    const fade = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      delay: delay * 1000,
      fill: "both",
    })
    const total = duration + (repeat ? repeatDelay : 0)
    const sweep = el.animate(
      repeat && repeatDelay > 0
        ? [
            { backgroundPosition: "100% center", offset: 0 },
            { backgroundPosition: "0% center", offset: duration / total },
            { backgroundPosition: "0% center", offset: 1 },
          ]
        : [
            { backgroundPosition: "100% center" },
            { backgroundPosition: "0% center" },
          ],
      {
        duration: total * 1000,
        delay: delay * 1000,
        iterations: repeat ? Infinity : 1,
        easing: "linear",
        fill: "both",
      }
    )
    return () => {
      fade.cancel()
      sweep.cancel()
    }
  }, [shouldAnimate, delay, duration, repeat, repeatDelay])

  return (
    <span
      ref={ref}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--base-color:var(--muted-foreground)] [--shimmer-color:var(--foreground)]",
        "[background-repeat:no-repeat,padding-box]",
        "[--shimmer-bg:linear-gradient(90deg,transparent_calc(50%-var(--spread)),var(--shimmer-color),transparent_calc(50%+var(--spread)))]",
        "dark:[--base-color:var(--muted-foreground)] dark:[--shimmer-color:var(--foreground)]",
        className
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          ...(color && { "--base-color": color }),
          ...(shimmerColor && { "--shimmer-color": shimmerColor }),
          backgroundImage: `var(--shimmer-bg), linear-gradient(var(--base-color), var(--base-color))`,
          backgroundPosition: "100% center",
          opacity: shouldAnimate ? undefined : 0,
        } as CSSProperties
      }
    >
      {text}
    </span>
  )
}
