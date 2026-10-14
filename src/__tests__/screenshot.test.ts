import { describe, it, expect } from 'vitest'
import { fitWithin, nativeCaptureSize } from '../lib/screenshot'

describe('screenshot sizing', () => {
  it('should capture at the physical resolution of a Retina display', () => {
    expect(nativeCaptureSize({ size: { width: 1512, height: 982 }, scaleFactor: 2 })).toEqual({ width: 3024, height: 1964 })
    expect(nativeCaptureSize({ size: { width: 1920, height: 1080 }, scaleFactor: 1 })).toEqual({ width: 1920, height: 1080 })
    expect(nativeCaptureSize({ size: { width: 1440, height: 900 }, scaleFactor: 0 })).toEqual({ width: 1440, height: 900 })
  })

  it('should downscale only past the limit, keeping the aspect ratio', () => {
    expect(fitWithin({ width: 3024, height: 1964 }, 1920)).toEqual({ width: 1920, height: 1247 })
    expect(fitWithin({ width: 1964, height: 3024 }, 1920)).toEqual({ width: 1247, height: 1920 })
    expect(fitWithin({ width: 1280, height: 800 }, 1920)).toEqual({ width: 1280, height: 800 })
  })
})
