import { DEFAULT_SETTINGS } from '../hooks/useGhostAI'
import { DEFAULT_PRESET_ID, defaultPresets, updatePreset } from '../lib/presets'
import type { Settings } from '../types'

// Settings for tests, built from the real defaults. `systemPrompt` and
// `suggestReplyPrompt` are applied to the General (default active) preset.
export function makeSettings(
  overrides: Partial<Settings> & { systemPrompt?: string; suggestReplyPrompt?: string } = {},
): Settings {
  const { systemPrompt, suggestReplyPrompt, ...rest } = overrides
  let presets = rest.presets ?? defaultPresets()
  if (systemPrompt !== undefined) presets = updatePreset(presets, DEFAULT_PRESET_ID, { systemPrompt })
  if (suggestReplyPrompt !== undefined) presets = updatePreset(presets, DEFAULT_PRESET_ID, { suggestReplyPrompt })
  return { ...DEFAULT_SETTINGS, ...rest, presets }
}
