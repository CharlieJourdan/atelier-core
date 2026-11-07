import { describe, expect, it } from 'vitest'
import { MIN_HEIGHT, MIN_WIDTH, parseWindowState, resolveBounds } from '../../src/main/platform/window-state'

const screen1 = { x: 0, y: 0, width: 1920, height: 1040 }

describe('window state', () => {
  it('parses a saved state and refuses junk', () => {
    expect(parseWindowState('{"width":1400,"height":900,"x":10,"y":20,"maximized":true}')).toEqual({ width: 1400, height: 900, x: 10, y: 20, maximized: true })
    expect(parseWindowState('nope')).toBeNull()
    expect(parseWindowState('{"width":"a","height":1}')).toBeNull()
    expect(parseWindowState(null)).toBeNull()
  })
  it('defaults without a saved state', () => {
    expect(resolveBounds(null, [screen1])).toEqual({ width: 1360, height: 860 })
  })
  it('never goes below the minimum or above the screen', () => {
    expect(resolveBounds({ width: 200, height: 100 }, [screen1])).toEqual({ width: MIN_WIDTH, height: MIN_HEIGHT })
    expect(resolveBounds({ width: 9000, height: 9000 }, [screen1])).toEqual({ width: 1920, height: 1040 })
  })
  it('keeps a place still on a screen, drops one that left (unplugged monitor)', () => {
    expect(resolveBounds({ width: 1200, height: 800, x: 100, y: 50 }, [screen1])).toEqual({ width: 1200, height: 800, x: 100, y: 50 })
    expect(resolveBounds({ width: 1200, height: 800, x: 3000, y: 50 }, [screen1])).toEqual({ width: 1200, height: 800 })
  })
})
