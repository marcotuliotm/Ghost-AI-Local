// Global shortcuts: defaults, validation, recording from key events and display.
// Pure module shared by the renderer (Settings recorder) and the main process
// (which registers them with globalShortcut). Accelerators use Electron syntax.

export type ShortcutAction = 'toggleOverlay' | 'screenshot' | 'cropScreenshot' | 'focusInput' | 'compactMode'
export type Shortcuts = Record<ShortcutAction, string>

export const DEFAULT_SHORTCUTS: Shortcuts = {
  toggleOverlay: 'CommandOrControl+Shift+G',
  screenshot: 'CommandOrControl+Shift+S',
  cropScreenshot: 'CommandOrControl+Shift+X',
  focusInput: 'CommandOrControl+Shift+A',
  compactMode: 'CommandOrControl+Shift+M',
}

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string }[] = [
  { id: 'toggleOverlay', label: 'Show/Hide overlay' },
  { id: 'screenshot', label: 'Capture screenshot & analyze' },
  { id: 'cropScreenshot', label: 'Crop screen region & analyze' },
  { id: 'focusInput', label: 'Focus text input' },
  { id: 'compactMode', label: 'Toggle compact mode' },
]

const MODIFIERS = new Set([
  'Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl',
  'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta',
])

const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Enter', 'Return', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
  'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Plus',
])

const PUNCTUATION = new Set([',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`'])

function isKey(token: string): boolean {
  return /^[A-Z0-9]$/.test(token)
    || /^F([1-9]|1\d|2[0-4])$/.test(token)
    || NAMED_KEYS.has(token)
    || PUNCTUATION.has(token)
}

/**
 * A usable global shortcut: modifiers then exactly one key. It must include a
 * modifier other than Shift (a bare or Shift-only key would swallow normal
 * typing system-wide), except for function keys.
 */
export function isValidAccelerator(accelerator: unknown): accelerator is string {
  if (typeof accelerator !== 'string' || !accelerator) return false
  // "Plus" is the key name for '+', so a literal '+' key can't appear here
  const tokens = accelerator.split('+')
  const key = tokens.pop()!
  if (!isKey(key)) return false
  if (tokens.some(t => !MODIFIERS.has(t))) return false
  if (new Set(tokens).size !== tokens.length) return false
  const hasRealModifier = tokens.some(t => t !== 'Shift')
  return hasRealModifier || /^F\d+$/.test(key)
}

export interface KeyEventLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

// KeyboardEvent.code → accelerator key. code is layout-independent and isn't
// changed by Option/Shift (Option+G would give key "©").
function keyFromCode(code: string): string | null {
  let m = code.match(/^Key([A-Z])$/)
  if (m) return m[1]
  m = code.match(/^Digit(\d)$/)
  if (m) return m[1]
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  const map: Record<string, string> = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[',
    BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  }
  return map[code] ?? null
}

/**
 * Turn a keydown into an accelerator, or null while only modifiers are held /
 * the combination isn't usable. On macOS Cmd maps to CommandOrControl (so the
 * default style is kept) and Ctrl to Control; elsewhere Ctrl is CommandOrControl.
 */
export function acceleratorFromKeyEvent(e: KeyEventLike, isMac: boolean): string | null {
  const key = keyFromCode(e.code)
  if (!key) return null
  const parts: string[] = []
  if (isMac) {
    if (e.metaKey) parts.push('CommandOrControl')
    if (e.ctrlKey) parts.push('Control')
  } else {
    if (e.ctrlKey) parts.push('CommandOrControl')
    if (e.metaKey) parts.push('Super')
  }
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const accelerator = [...parts, key].join('+')
  return isValidAccelerator(accelerator) ? accelerator : null
}

// Human-readable form for labels: "Cmd+Shift+G" on macOS, "Ctrl+Shift+G" elsewhere.
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  return accelerator
    .split('+')
    .map(t => {
      switch (t) {
        case 'CommandOrControl': case 'CmdOrCtrl': return isMac ? 'Cmd' : 'Ctrl'
        case 'Command': case 'Cmd': return 'Cmd'
        case 'Control': case 'Ctrl': return 'Ctrl'
        case 'Alt': case 'Option': return isMac ? 'Option' : 'Alt'
        case 'Super': case 'Meta': return isMac ? 'Cmd' : 'Win'
        case 'Plus': return '+'
        default: return t
      }
    })
    .join('+')
}

// Actions sharing an accelerator with another action (each would cancel the other).
export function findDuplicateShortcuts(shortcuts: Shortcuts): ShortcutAction[] {
  const seen = new Map<string, ShortcutAction[]>()
  for (const { id } of SHORTCUT_ACTIONS) {
    const acc = shortcuts[id].replace(/\bCmdOrCtrl\b/g, 'CommandOrControl')
    seen.set(acc, [...(seen.get(acc) ?? []), id])
  }
  return [...seen.values()].filter(ids => ids.length > 1).flat()
}

// Stored shortcuts: every action gets a valid accelerator (default if missing/invalid).
export function mergeShortcuts(stored: unknown): Shortcuts {
  const s = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {}
  const out = { ...DEFAULT_SHORTCUTS }
  for (const { id } of SHORTCUT_ACTIONS) {
    if (isValidAccelerator(s[id])) out[id] = s[id] as string
  }
  return out
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)
}
