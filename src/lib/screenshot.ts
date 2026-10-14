// Screenshot sizing. Pure module used by the main process.

export interface Size {
  width: number
  height: number
}

// Full screenshots sent to the model: vision models downscale to well under
// this anyway, so a 5K capture would only cost memory and IPC time.
export const FULL_SCREENSHOT_MAX_EDGE = 1920

// Capture at the display's physical resolution (points × scale factor), so a
// crop of small text on a Retina screen stays sharp.
export function nativeCaptureSize(display: { size: Size; scaleFactor: number }): Size {
  const factor = display.scaleFactor > 0 ? display.scaleFactor : 1
  return {
    width: Math.round(display.size.width * factor),
    height: Math.round(display.size.height * factor),
  }
}

// Scale `size` down (never up) so its longer edge is at most `maxEdge`, keeping the aspect ratio.
export function fitWithin(size: Size, maxEdge: number): Size {
  const longest = Math.max(size.width, size.height)
  if (longest <= maxEdge || longest === 0) return { ...size }
  const ratio = maxEdge / longest
  return { width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) }
}
