import { describe, it, expect } from 'vitest'
import { defaultWindowBounds, WINDOW_MIN_SIZE, WINDOW_SIZE } from '../lib/window'

describe('defaultWindowBounds', () => {
  it('should sit at the top-right of the work area at full size', () => {
    expect(defaultWindowBounds({ x: 0, y: 25, width: 1512, height: 920 })).toEqual({ x: 1512 - WINDOW_SIZE.width - 20, y: 45, ...WINDOW_SIZE })
  })

  it('should follow a display that is not at the origin', () => {
    const b = defaultWindowBounds({ x: 1512, y: 0, width: 1920, height: 1055 })
    expect(b.x + b.width).toBe(1512 + 1920 - 20)
    expect(b.y).toBe(20)
  })

  it('should shrink on small screens but not below the minimum', () => {
    const b = defaultWindowBounds({ x: 0, y: 25, width: 1280, height: 700 })
    expect(b.height).toBe(660)
    expect(b.y + b.height).toBeLessThanOrEqual(725)
    const tiny = defaultWindowBounds({ x: 0, y: 0, width: 480, height: 500 })
    expect(tiny.width).toBe(WINDOW_MIN_SIZE.width)
    expect(tiny.height).toBe(WINDOW_MIN_SIZE.height)
    expect(tiny.x).toBeGreaterThanOrEqual(0)
  })
})
