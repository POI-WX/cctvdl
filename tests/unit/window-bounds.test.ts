import { describe, it, expect } from 'vitest'
import { sanitizeBounds } from '../../src/shared/window-bounds'

const area = { x: 0, y: 0, width: 1920, height: 1080 }

describe('sanitizeBounds', () => {
  it('returns null for missing/invalid input', () => {
    expect(sanitizeBounds(undefined, area)).toBeNull()
    expect(sanitizeBounds(null, area)).toBeNull()
    expect(sanitizeBounds({ x: 0, y: 0 } as any, area)).toBeNull()
    expect(sanitizeBounds({ width: NaN, height: 100 } as any, area)).toBeNull()
  })

  it('keeps a valid on-screen rect intact', () => {
    const b = sanitizeBounds({ x: 100, y: 80, width: 1000, height: 700 }, area)
    expect(b).toEqual({ x: 100, y: 80, width: 1000, height: 700, maximized: false })
  })

  it('clamps size to the work area and min size', () => {
    expect(sanitizeBounds({ width: 5000, height: 4000 }, area))
      .toMatchObject({ width: 1920, height: 1080 })
    expect(sanitizeBounds({ width: 100, height: 50 }, area))
      .toMatchObject({ width: 720, height: 520 })
  })

  it('drops an off-screen position (centers via undefined x/y)', () => {
    // saved on a now-disconnected monitor at x=3000
    const b = sanitizeBounds({ x: 3000, y: 100, width: 1000, height: 700 }, area)
    expect(b!.x).toBeUndefined()
    expect(b!.y).toBeUndefined()
    expect(b).toMatchObject({ width: 1000, height: 700 })
  })

  it('drops a negative off-screen position', () => {
    const b = sanitizeBounds({ x: -500, y: -500, width: 1000, height: 700 }, area)
    expect(b!.x).toBeUndefined()
    expect(b!.y).toBeUndefined()
  })

  it('preserves the maximized flag', () => {
    const b = sanitizeBounds({ width: 1000, height: 700, maximized: true }, area)
    expect(b!.maximized).toBe(true)
  })

  it('respects a non-zero work area origin (e.g. taskbar/secondary display)', () => {
    const offset = { x: 100, y: 100, width: 1000, height: 800 }
    // x=120,y=120 is inside; width 900 fits (120+900=1020 <= 1100)
    const b = sanitizeBounds({ x: 120, y: 120, width: 900, height: 700 }, offset)
    expect(b).toMatchObject({ x: 120, y: 120, width: 900, height: 700 })
    // x=50 is left of origin -> dropped
    expect(sanitizeBounds({ x: 50, y: 120, width: 900, height: 700 }, offset)!.x).toBeUndefined()
  })
})
