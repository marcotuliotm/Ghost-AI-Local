// Compact mode window geometry. Pure module shared with the main process.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Small enough to sit over a call without covering it, big enough for a short reply.
export const COMPACT_SIZE = { width: 400, height: 180 }

/**
 * Bounds for the compact window: anchored to the top-right corner of the
 * normal window (where the overlay usually sits), kept inside the work area of
 * that display.
 */
export function compactBounds(normal: Rect, workArea: Rect, size = COMPACT_SIZE): Rect {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  const right = normal.x + normal.width
  const x = Math.min(Math.max(right - width, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(normal.y, workArea.y), workArea.y + workArea.height - height)
  return { x, y, width, height }
}
