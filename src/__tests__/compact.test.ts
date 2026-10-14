import { describe, it, expect } from 'vitest'
import { COMPACT_SIZE, compactBounds } from '../lib/compact'

const workArea = { x: 0, y: 25, width: 1710, height: 1050 }

describe('compactBounds', () => {
  it('should anchor the card to the top-right corner of the window', () => {
    expect(compactBounds({ x: 1270, y: 60, width: 420, height: 680 }, workArea))
      .toEqual({ x: 1690 - COMPACT_SIZE.width, y: 60, ...COMPACT_SIZE })
  })

  it('should stay inside the work area', () => {
    expect(compactBounds({ x: -200, y: 0, width: 300, height: 500 }, workArea)).toEqual({ x: 0, y: 25, ...COMPACT_SIZE })
    expect(compactBounds({ x: 1500, y: 1000, width: 420, height: 680 }, workArea))
      .toEqual({ x: 1710 - COMPACT_SIZE.width, y: 1075 - COMPACT_SIZE.height, ...COMPACT_SIZE })
  })

  it('should work on a secondary display', () => {
    const second = { x: 1710, y: 0, width: 1920, height: 1080 }
    expect(compactBounds({ x: 3000, y: 100, width: 420, height: 680 }, second)).toEqual({ x: 3060, y: 100, ...COMPACT_SIZE })
  })
})
