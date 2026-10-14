import { describe, it, expect } from 'vitest'
import {
  BUILTIN_PRESETS,
  createPreset,
  defaultPresets,
  deletePreset,
  duplicatePreset,
  fillSuggestReplyPrompt,
  getActivePreset,
  isBuiltInPreset,
  mergePresets,
  renamePreset,
  restorePreset,
  updatePreset,
} from '../lib/presets'

describe('built-in presets', () => {
  it('should ship General, Technical interview, Sales call and Lecture/Class', () => {
    expect(BUILTIN_PRESETS.map(p => p.name)).toEqual(['General', 'Technical interview', 'Sales call', 'Lecture/Class'])
  })

  it('should keep the original quick actions in General', () => {
    expect(BUILTIN_PRESETS[0].quickActions.map(q => q.label)).toEqual(['Summarize', 'Suggest reply', 'Next steps'])
  })

  it('should have a {{transcript}} placeholder and quick actions in every preset', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.suggestReplyPrompt).toContain('{{transcript}}')
      expect(p.quickActions.length).toBeGreaterThan(0)
      expect(isBuiltInPreset(p.id)).toBe(true)
    }
  })

  it('should hand out independent copies', () => {
    const presets = defaultPresets()
    presets[0].quickActions[0].label = 'changed'
    expect(BUILTIN_PRESETS[0].quickActions[0].label).toBe('Summarize')
  })
})

describe('preset CRUD', () => {
  it('should create a preset with a unique name', () => {
    const first = createPreset(defaultPresets())
    const second = createPreset(first.presets)
    expect(first.presets.at(-1)).toMatchObject({ id: first.id, name: 'New preset' })
    expect(second.presets.at(-1)).toMatchObject({ id: second.id, name: 'New preset 2' })
    expect(isBuiltInPreset(first.id)).toBe(false)
  })

  it('should duplicate a preset with its prompts and quick actions', () => {
    const presets = defaultPresets()
    const result = duplicatePreset(presets, 'sales-call')!
    const copy = result.presets.find(p => p.id === result.id)!
    expect(copy.name).toBe('Sales call copy')
    expect(copy.systemPrompt).toBe(presets[2].systemPrompt)
    expect(copy.quickActions).toEqual(presets[2].quickActions)
    expect(copy.quickActions).not.toBe(presets[2].quickActions)
    expect(duplicatePreset(presets, 'missing')).toBeNull()
  })

  it('should rename and update without touching other presets', () => {
    let presets = defaultPresets()
    presets = renamePreset(presets, 'lecture', 'Biology 101')
    presets = updatePreset(presets, 'lecture', { quickActions: [{ label: 'Quiz', prompt: 'Quiz me' }] })
    const lecture = presets.find(p => p.id === 'lecture')!
    expect(lecture.name).toBe('Biology 101')
    expect(lecture.quickActions).toEqual([{ label: 'Quiz', prompt: 'Quiz me' }])
    expect(presets[0]).toEqual(BUILTIN_PRESETS[0])
  })

  it('should never delete a built-in preset', () => {
    const presets = defaultPresets()
    expect(deletePreset(presets, 'general')).toBe(presets)
    expect(deletePreset(presets, 'technical-interview')).toHaveLength(BUILTIN_PRESETS.length)
  })

  it('should delete a user preset', () => {
    const { presets, id } = createPreset(defaultPresets())
    expect(deletePreset(presets, id).some(p => p.id === id)).toBe(false)
  })

  it('should restore an edited built-in preset', () => {
    const edited = updatePreset(defaultPresets(), 'general', { name: 'Mine', systemPrompt: 'x', quickActions: [] })
    expect(restorePreset(edited, 'general')[0]).toEqual(BUILTIN_PRESETS[0])
  })

  it('should not restore a user preset', () => {
    const { presets, id } = createPreset(defaultPresets())
    expect(restorePreset(presets, id)).toBe(presets)
  })
})

describe('getActivePreset', () => {
  it('should return the active preset, falling back to the first one', () => {
    const presets = defaultPresets()
    expect(getActivePreset({ presets, activePresetId: 'sales-call' }).name).toBe('Sales call')
    expect(getActivePreset({ presets, activePresetId: 'missing' }).id).toBe('general')
    expect(getActivePreset({ presets: [], activePresetId: 'x' }).id).toBe('general')
  })
})

describe('mergePresets', () => {
  it('should restore missing built-ins and keep edits and user presets', () => {
    const edited = { ...BUILTIN_PRESETS[1], name: 'My interview' }
    const custom = { id: 'u1', name: 'Custom', systemPrompt: 's', suggestReplyPrompt: 'r', quickActions: [] }
    const merged = mergePresets([custom, edited])
    expect(merged.map(p => p.id)).toEqual(['general', 'technical-interview', 'sales-call', 'lecture', 'u1'])
    expect(merged[1].name).toBe('My interview')
  })

  it('should drop malformed entries and duplicate ids', () => {
    const ok = { id: 'u1', name: 'A', systemPrompt: '', suggestReplyPrompt: '', quickActions: [{ label: 'x', prompt: 'y' }, { label: 1 }] }
    const merged = mergePresets([ok, { ...ok, name: 'dupe' }, { id: 'bad' }, null, 'x'])
    const custom = merged.filter(p => !isBuiltInPreset(p.id))
    expect(custom).toHaveLength(1)
    expect(custom[0].name).toBe('A')
    expect(custom[0].quickActions).toEqual([{ label: 'x', prompt: 'y' }])
  })

  it('should return the built-ins for non-array input', () => {
    expect(mergePresets(undefined)).toEqual(defaultPresets())
  })
})

describe('fillSuggestReplyPrompt', () => {
  it('should replace every {{transcript}} with the excerpt', () => {
    expect(fillSuggestReplyPrompt('Said: {{transcript}} / again: {{transcript}}', 'hi'))
      .toBe('Said: hi / again: hi')
  })

  it('should insert only the given excerpt (Auto sends just the new text)', () => {
    const prompt = fillSuggestReplyPrompt('They said: "{{transcript}}"', 'A: and the deadline?')
    expect(prompt).toBe('They said: "A: and the deadline?"')
  })

  it('should append the excerpt when the template has no placeholder', () => {
    expect(fillSuggestReplyPrompt('Help me answer.', 'B: why?')).toBe('Help me answer.\n\n"B: why?"')
  })

  it('should fall back to the General template when empty', () => {
    expect(fillSuggestReplyPrompt('  ', 'x')).toContain('The other person said: "x"')
  })
})
