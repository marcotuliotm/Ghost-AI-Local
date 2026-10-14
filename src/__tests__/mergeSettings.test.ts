import { describe, it, expect } from 'vitest'
import { mergeSettings } from '../lib/settings'
import { DEFAULT_SETTINGS } from '../hooks/useGhostAI'
import { BUILTIN_PRESETS } from '../lib/presets'

describe('mergeSettings', () => {
  it('should return the defaults when nothing is stored', () => {
    for (const stored of [null, undefined, 'garbage', 42, ['a']]) {
      expect(mergeSettings(DEFAULT_SETTINGS, stored)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('should keep stored values over the defaults', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      selectedModel: 'llama3:8b',
      opacity: 0.6,
      contextLength: 16384,
      whisperModel: 'onnx-community/whisper-small',
      transcriptionLanguage: 'portuguese',
    })
    expect(merged.selectedModel).toBe('llama3:8b')
    expect(merged.opacity).toBe(0.6)
    expect(merged.contextLength).toBe(16384)
    expect(merged.whisperModel).toBe('onnx-community/whisper-small')
    expect(merged.transcriptionLanguage).toBe('portuguese')
  })

  it('should give fields missing from older saves their defaults', () => {
    // Saved before contextLength / Whisper / presets existed
    const merged = mergeSettings(DEFAULT_SETTINGS, { selectedModel: 'llama3:8b', fontSize: 14 })
    expect(merged.contextLength).toBe(8192)
    expect(merged.whisperModel).toBe('onnx-community/whisper-base')
    expect(merged.transcriptionLanguage).toBe(DEFAULT_SETTINGS.transcriptionLanguage)
    expect(merged.presets.map(p => p.id)).toEqual(BUILTIN_PRESETS.map(p => p.id))
    expect(merged.activePresetId).toBe('general')
    expect(merged.fontSize).toBe(14)
  })

  it('should ignore values of the wrong type and non-finite numbers', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { opacity: '0.5', contextLength: NaN, fontSize: null, selectedModel: 7 })
    expect(merged.opacity).toBe(0.9)
    expect(merged.contextLength).toBe(8192)
    expect(merged.fontSize).toBe(12)
    expect(merged.selectedModel).toBe('gemma4:latest')
  })

  it('should drop unknown and legacy keys', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { language: 'pt-BR', systemPrompt: 'old', bogus: true }) as any
    expect(merged.language).toBeUndefined()
    expect(merged.systemPrompt).toBeUndefined()
    expect(merged.bogus).toBeUndefined()
  })

  it('should fall back for an unknown Whisper model or language', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { whisperModel: 'evil/model', transcriptionLanguage: 'klingon' })
    expect(merged.whisperModel).toBe(DEFAULT_SETTINGS.whisperModel)
    expect(merged.transcriptionLanguage).toBe(DEFAULT_SETTINGS.transcriptionLanguage)
  })

  it('should keep stored custom presets and the active one', () => {
    const custom = { id: 'mine', name: 'Mine', systemPrompt: 's', suggestReplyPrompt: '{{transcript}}', quickActions: [] }
    const merged = mergeSettings(DEFAULT_SETTINGS, { presets: [custom], activePresetId: 'mine' })
    expect(merged.presets.at(-1)).toEqual(custom)
    expect(merged.presets).toHaveLength(BUILTIN_PRESETS.length + 1)
    expect(merged.activePresetId).toBe('mine')
  })

  it('should reset an active preset id that no longer exists', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { activePresetId: 'deleted' })
    expect(merged.activePresetId).toBe('general')
  })

  it('should not share preset objects with the defaults', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, null)
    merged.presets[0].name = 'changed'
    expect(DEFAULT_SETTINGS.presets[0].name).toBe('General')
  })

  it('should replace a stored non-local Ollama URL with the default', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { ollamaBaseUrl: 'http://10.0.0.2:11434' }).ollamaBaseUrl).toBe('http://localhost:11434')
    expect(mergeSettings(DEFAULT_SETTINGS, { ollamaBaseUrl: 'http://127.0.0.1:9000' }).ollamaBaseUrl).toBe('http://127.0.0.1:9000')
  })

  it('should default reasoning to on and keep a stored choice', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, {}).reasoning).toBe(true)
    expect(mergeSettings(DEFAULT_SETTINGS, { reasoning: false }).reasoning).toBe(false)
  })

  it('should merge stored shortcuts and keep content protection on by default', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { shortcuts: { screenshot: 'Alt+F2', toggleOverlay: 'G' } })
    expect(merged.shortcuts.screenshot).toBe('Alt+F2')
    expect(merged.shortcuts.toggleOverlay).toBe('CommandOrControl+Shift+G')
    expect(merged.hideFromScreenShare).toBe(true)
    expect(mergeSettings(DEFAULT_SETTINGS, { hideFromScreenShare: false }).hideFromScreenShare).toBe(false)
  })

  it('should not share the shortcuts object with the defaults', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, null)
    merged.shortcuts.screenshot = 'Alt+F3'
    expect(DEFAULT_SETTINGS.shortcuts.screenshot).toBe('CommandOrControl+Shift+S')
  })
})
