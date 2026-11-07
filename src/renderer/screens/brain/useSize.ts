// Measures an element (ResizeObserver) so the SVG maps are drawn in real pixels: circles stay circles and text keeps its
// size at any width. Before the first measure (and in static renders) the fallback size is used.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

export function useSize<T extends HTMLElement>(fallback: { w: number; h: number }): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}
