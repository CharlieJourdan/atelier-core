// Which component shows a route (lot Z1). Keys are `section` or `section/page`. Each area owns its map in
// `screens/<area>/index.ts`, so parallel work never edits the same file; SectionScreen merges them. Screens are imported
// statically (no React.lazy): the demo-badge test renders every route with renderToStaticMarkup.
import type { ComponentType } from 'react'
import type { Route } from '../../shared/sections'

export interface ScreenProps {
  route: Route
  onRoute: (r: Route) => void
}

export type ScreenMap = Readonly<Record<string, ComponentType<ScreenProps>>>

export function routeKey(route: Pick<Route, 'section' | 'page'>): string {
  return route.page ? `${route.section}/${route.page}` : route.section
}
