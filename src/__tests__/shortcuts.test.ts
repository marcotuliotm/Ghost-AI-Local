import { describe, it, expect } from 'vitest'
import {
  acceleratorFromKeyEvent,
  DEFAULT_SHORTCUTS,
  findDuplicateShortcuts,
  formatAccelerator,
  isValidAccelerator,
  mergeShortcuts,
} from '../lib/shortcuts'

const key = (code: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  key: code, code,
  metaKey: Boolean(mods.meta), ctrlKey: Boolean(mods.ctrl), altKey: Boolean(mods.alt), shiftKey: Boolean(mods.shift),
})

describe('isValidAccelerator', () => {
  it('should accept the defaults and common combinations', () => {
    for (const acc of [...Object.values(DEFAULT_SHORTCUTS), 'Alt+Space', 'CommandOrControl+Alt+1', 'F5', 'Shift+F12', 'Control+Shift+Up', 'CmdOrCtrl+.']) {
      expect(isValidAccelerator(acc), acc).toBe(true)
    }
  })

  it('should reject bare keys, Shift-only keys and malformed input', () => {
    for (const acc of ['G', 'Shift+G', 'CommandOrControl', 'CommandOrControl+Shift', 'Hyper+G', 'CommandOrControl+GG', 'Shift+Shift+F1', '', undefined, 3]) {
      expect(isValidAccelerator(acc), String(acc)).toBe(false)
    }
  })
})

describe('acceleratorFromKeyEvent', () => {
  it('should record Cmd as CommandOrControl on macOS', () => {
    expect(acceleratorFromKeyEvent(key('KeyK', { meta: true, shift: true }), true)).toBe('CommandOrControl+Shift+K')
    expect(acceleratorFromKeyEvent(key('KeyK', { ctrl: true }), true)).toBe('Control+K')
  })

  it('should record Ctrl as CommandOrControl elsewhere', () => {
    expect(acceleratorFromKeyEvent(key('KeyK', { ctrl: true, alt: true }), false)).toBe('CommandOrControl+Alt+K')
  })

  it('should use the physical key, not the typed character', () => {
    // Option+G types "©" on a Mac keyboard; the shortcut is still G
    expect(acceleratorFromKeyEvent({ ...key('KeyG', { alt: true, meta: true }), key: '©' }, true)).toBe('CommandOrControl+Alt+G')
    expect(acceleratorFromKeyEvent(key('Digit2', { meta: true }), true)).toBe('CommandOrControl+2')
    expect(acceleratorFromKeyEvent(key('ArrowUp', { meta: true }), true)).toBe('CommandOrControl+Up')
  })

  it('should return null for modifier-only or unusable combinations', () => {
    expect(acceleratorFromKeyEvent(key('MetaLeft', { meta: true }), true)).toBeNull()
    expect(acceleratorFromKeyEvent(key('KeyG'), true)).toBeNull()
    expect(acceleratorFromKeyEvent(key('KeyG', { shift: true }), true)).toBeNull()
    expect(acceleratorFromKeyEvent(key('F6'), true)).toBe('F6')
  })
})

describe('formatAccelerator', () => {
  it('should show platform names', () => {
    expect(formatAccelerator('CommandOrControl+Shift+G', true)).toBe('Cmd+Shift+G')
    expect(formatAccelerator('CommandOrControl+Shift+G', false)).toBe('Ctrl+Shift+G')
    expect(formatAccelerator('Control+Alt+Plus', true)).toBe('Ctrl+Option++')
    expect(formatAccelerator('Super+Alt+K', false)).toBe('Win+Alt+K')
  })
})

describe('findDuplicateShortcuts', () => {
  it('should flag actions sharing a combination', () => {
    expect(findDuplicateShortcuts(DEFAULT_SHORTCUTS)).toEqual([])
    expect(findDuplicateShortcuts({ ...DEFAULT_SHORTCUTS, focusInput: 'CmdOrCtrl+Shift+G' }).sort())
      .toEqual(['focusInput', 'toggleOverlay'])
  })
})

describe('mergeShortcuts', () => {
  it('should keep valid stored shortcuts and default the rest', () => {
    expect(mergeShortcuts({ screenshot: 'Alt+F1', focusInput: 'K', bogus: 'Alt+B' })).toEqual({
      ...DEFAULT_SHORTCUTS, screenshot: 'Alt+F1',
    })
    expect(mergeShortcuts(null)).toEqual(DEFAULT_SHORTCUTS)
  })

describe('compact mode shortcut', () => {
  it('should have a default and fill it in for older stored shortcuts', () => {
    expect(DEFAULT_SHORTCUTS.compactMode).toBe('CommandOrControl+Shift+M')
    expect(mergeShortcuts({ toggleOverlay: 'Alt+F1' }).compactMode).toBe('CommandOrControl+Shift+M')
    expect(findDuplicateShortcuts(DEFAULT_SHORTCUTS)).toEqual([])
  })
})
})
