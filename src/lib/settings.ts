import type { Settings } from '../types'
import { mergePresets } from './presets'
import { isTranscriptionLanguage, isWhisperModel } from './whisper'
import { isLocalOllamaUrl } from './ollama'

/**
 * Settings read from disk, merged over the defaults. Only known keys whose
 * stored value has the default's type are kept, so a field added in a later
 * version (e.g. contextLength) gets its default and a corrupt or obsolete
 * value (like the legacy `language`) is ignored instead of crashing the UI.
 */
export function mergeSettings(defaults: Settings, stored: unknown): Settings {
  const merged: Settings = { ...defaults, presets: mergePresets(defaults.presets) }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return merged

  const s = stored as Record<string, unknown>
  const out = merged as unknown as Record<string, unknown>
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (key === 'presets') continue
    const value = s[key]
    const fallback = defaults[key]
    if (typeof value !== typeof fallback) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    out[key] = value
  }

  if ('presets' in s) merged.presets = mergePresets(s.presets)
  if (!merged.presets.some(p => p.id === merged.activePresetId)) merged.activePresetId = defaults.activePresetId
  // Only a local Ollama is allowed (see lib/ollama.ts)
  if (!isLocalOllamaUrl(merged.ollamaBaseUrl)) merged.ollamaBaseUrl = defaults.ollamaBaseUrl
  if (!isWhisperModel(merged.whisperModel)) merged.whisperModel = defaults.whisperModel
  if (!isTranscriptionLanguage(merged.transcriptionLanguage)) merged.transcriptionLanguage = defaults.transcriptionLanguage
  return merged
}
