import type { Settings } from '../types'
import { mergePresets } from './presets'
import { isTranscriptionLanguage, isWhisperModel } from './whisper'
import { isLocalOllamaUrl } from './ollama'
import { mergeShortcuts } from './shortcuts'

// Body text size in px (macOS: 13 by default, the accessibility sizes go up to ~17)
export const FONT_SIZE_MIN = 11
export const FONT_SIZE_MAX = 17

/**
 * Settings read from disk, merged over the defaults. Only known keys whose
 * stored value has the default's type are kept, so a field added in a later
 * version (e.g. contextLength) gets its default and a corrupt or obsolete
 * value (like the legacy `language`) is ignored instead of crashing the UI.
 */
export function mergeSettings(defaults: Settings, stored: unknown): Settings {
  const merged: Settings = { ...defaults, presets: mergePresets(defaults.presets), shortcuts: mergeShortcuts(defaults.shortcuts) }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return merged

  const s = stored as Record<string, unknown>
  const out = merged as unknown as Record<string, unknown>
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (key === 'presets' || key === 'shortcuts') continue
    const value = s[key]
    const fallback = defaults[key]
    if (typeof value !== typeof fallback) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    out[key] = value
  }

  if ('presets' in s) merged.presets = mergePresets(s.presets)
  // Settings saved before the first-run setup existed: not a new user
  if (!('onboardingCompleted' in s)) merged.onboardingCompleted = true
  merged.shortcuts = mergeShortcuts(s.shortcuts)
  if (!merged.presets.some(p => p.id === merged.activePresetId)) merged.activePresetId = defaults.activePresetId
  // Only a local Ollama is allowed (see lib/ollama.ts)
  if (!isLocalOllamaUrl(merged.ollamaBaseUrl)) merged.ollamaBaseUrl = defaults.ollamaBaseUrl
  if (!isWhisperModel(merged.whisperModel)) merged.whisperModel = defaults.whisperModel
  if (!isTranscriptionLanguage(merged.transcriptionLanguage)) merged.transcriptionLanguage = defaults.transcriptionLanguage
  // The whole UI scales with it: keep it readable and within the layout
  merged.fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(merged.fontSize)))
  return merged
}
