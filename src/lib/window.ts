import type { Rect } from './compact'

// Main window geometry (macOS 27 sizing). Pure module shared with the main process.

// Wide enough for the toolbar's buttons at the standard macOS size
export const WINDOW_SIZE = { width: 560, height: 760 }
export const WINDOW_MIN_SIZE = { width: 460, height: 480 }

// Unified toolbar: 52pt tall, traffic lights centered in it
export const TOOLBAR_HEIGHT = 52
export const TRAFFIC_LIGHT_POSITION = { x: 18, y: 19 }

const MARGIN = 20

/** Default bounds: top-right of the work area, shrunk to fit small screens. */
export function defaultWindowBounds(workArea: Rect, size = WINDOW_SIZE): Rect {
  const width = Math.max(Math.min(size.width, workArea.width - 2 * MARGIN), Math.min(WINDOW_MIN_SIZE.width, workArea.width))
  const height = Math.max(Math.min(size.height, workArea.height - 2 * MARGIN), Math.min(WINDOW_MIN_SIZE.height, workArea.height))
  return {
    x: workArea.x + Math.max(0, workArea.width - width - MARGIN),
    y: workArea.y + Math.min(MARGIN, Math.max(0, workArea.height - height)),
    width,
    height,
  }
}
