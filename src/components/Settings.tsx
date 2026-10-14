import { useState, useEffect } from 'react'
import type { Settings, OllamaModel, Preset } from '../types'
import {
  createPreset,
  deletePreset,
  duplicatePreset,
  getActivePreset,
  isBuiltInPreset,
  restorePreset,
  updatePreset,
} from '../lib/presets'
import {
  formatModelSize,
  isEnglishOnlyModel,
  TRANSCRIPTION_LANGUAGES,
  WHISPER_MODELS,
} from '../lib/whisper'
import { isLocalOllamaUrl, supportsThinking } from '../lib/ollama'
import {
  DEFAULT_SHORTCUTS,
  findDuplicateShortcuts,
  isMacPlatform,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
} from '../lib/shortcuts'
import { ShortcutRecorder } from './ShortcutRecorder'

const CONTEXT_LENGTH_OPTIONS = [4096, 8192, 16384, 32768]

const SELECT_CLASS = 'w-full bg-ghost-fill border border-ghost-border rounded-lg px-3 py-1.5 text-xs text-ghost-text focus:outline-none focus:border-ghost-accent focus:ring-2 focus:ring-ghost-accent/30 transition-colors appearance-none'
const TEXTAREA_CLASS = 'w-full bg-ghost-fill border border-ghost-border rounded-lg px-3 py-2 text-xs text-ghost-text placeholder-ghost-text-muted/50 focus:outline-none focus:border-ghost-accent focus:ring-2 focus:ring-ghost-accent/30 transition-colors resize-none'
const SMALL_BUTTON_CLASS = 'px-2 py-0.5 rounded text-[10px] bg-ghost-fill text-ghost-text-muted hover:bg-ghost-fill-strong hover:text-ghost-text transition-colors disabled:opacity-30'

interface SettingsPanelProps {
  settings: Settings
  models: OllamaModel[]
  isConnected: boolean
  onUpdateSettings: (settings: Partial<Settings>) => void
  onBack: () => void
  onRefreshModels: () => Promise<OllamaModel[]>
  onCheckConnection: () => Promise<boolean>
  // Saved shortcuts the main process could not register (owned by another app)
  shortcutErrors?: ShortcutAction[]
}

export function SettingsPanel({
  settings,
  models,
  isConnected,
  onUpdateSettings,
  onBack,
  onRefreshModels,
  onCheckConnection,
  shortcutErrors = [],
}: SettingsPanelProps) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  // Only a local Ollama is allowed; the main process enforces it too.
  const urlIsLocal = isLocalOllamaUrl(localSettings.ollamaBaseUrl)
  const selectedModelInfo = models.find(m => m.name === localSettings.selectedModel)

  const isMac = isMacPlatform()
  const duplicateShortcuts = findDuplicateShortcuts(localSettings.shortcuts)
  const shortcutError = (id: ShortcutAction): string | undefined => {
    if (duplicateShortcuts.includes(id)) return 'Used by another action'
    // A registration failure refers to the saved combination; editing it clears the error
    if (shortcutErrors.includes(id) && localSettings.shortcuts[id] === settings.shortcuts[id]) {
      return 'In use by another app'
    }
    return undefined
  }
  const canSave = urlIsLocal && duplicateShortcuts.length === 0

  const handleSave = () => {
    if (!canSave) return
    onUpdateSettings(localSettings)
    onBack()
  }

  // Opacity and font size preview live while dragging the sliders. Leaving
  // without saving must put the saved values back.
  const handleBack = () => {
    window.ghostAPI.setOpacity(settings.opacity)
    document.documentElement.style.setProperty('--ghost-font-size', `${settings.fontSize}px`)
    onBack()
  }

  // Preset edits stay local until Save, like every other setting.
  const editPresets = (fn: (presets: Preset[], activeId: string) => { presets: Preset[]; activePresetId?: string }) => {
    setLocalSettings(prev => {
      const result = fn(prev.presets, prev.activePresetId)
      return { ...prev, presets: result.presets, activePresetId: result.activePresetId ?? prev.activePresetId }
    })
  }
  const editActivePreset = (patch: Partial<Omit<Preset, 'id'>>) =>
    editPresets((presets, activeId) => ({ presets: updatePreset(presets, activeId, patch) }))

  const activePreset = getActivePreset(localSettings)
  const activeIsBuiltIn = isBuiltInPreset(activePreset.id)
  const englishOnlyWhisper = isEnglishOnlyModel(localSettings.whisperModel)

  const handleCheckConnection = async () => {
    setIsChecking(true)
    await onCheckConnection()
    await onRefreshModels()
    setIsChecking(false)
  }

  return (
    <div className="w-full h-full flex flex-col glass rounded-xl overflow-hidden animate-fade-in">
      {/* Header — pl clears the native macOS traffic-light buttons (top-left) */}
      <div className="flex items-center justify-between pl-[78px] pr-4 py-3 border-b border-ghost-border drag-region">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors no-drag"
          >
            <svg className="w-4 h-4 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-ghost-text">Settings</span>
        </div>
        <button
          onClick={handleSave}
          disabled={!canSave}
          title={!urlIsLocal ? 'The Ollama URL must be local' : duplicateShortcuts.length > 0 ? 'Two actions share a shortcut' : undefined}
          className="px-3 py-1 rounded-lg bg-ghost-accent hover:bg-ghost-accent-hover text-xs text-white transition-colors no-drag disabled:opacity-40 disabled:hover:bg-ghost-accent"
        >
          Save
        </button>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 no-drag">
        {/* Connection Status */}
        <Section title="Ollama Connection">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-ghost-success' : 'bg-ghost-error'}`} />
            <span className="text-xs text-ghost-text-muted">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <button
              onClick={handleCheckConnection}
              disabled={isChecking}
              className="ml-auto text-[10px] text-ghost-accent hover:text-ghost-accent-hover transition-colors disabled:opacity-50"
            >
              {isChecking ? 'Checking...' : 'Check'}
            </button>
          </div>
          <Input
            label="Ollama Base URL"
            value={localSettings.ollamaBaseUrl}
            onChange={v => setLocalSettings(prev => ({ ...prev, ollamaBaseUrl: v }))}
            placeholder="http://localhost:11434"
          />
          {urlIsLocal ? (
            <p className="text-[9px] text-ghost-text-muted opacity-60 mt-1">
              Must be on this machine (localhost, 127.0.0.1 or ::1). Cloud models are hidden.
            </p>
          ) : (
            <p className="text-[9px] text-ghost-error mt-1" role="alert">
              Only a local Ollama is allowed (localhost, 127.0.0.1 or ::1), so no data leaves this machine.
            </p>
          )}
        </Section>

        {/* Model Selection */}
        <Section title="Model">
          <div className="space-y-2">
            <label className="text-[10px] text-ghost-text-muted uppercase tracking-wider">
              Active Model
            </label>
            <select
              value={localSettings.selectedModel}
              onChange={e => setLocalSettings(prev => ({ ...prev, selectedModel: e.target.value }))}
              className={SELECT_CLASS}
            >
              {models.length === 0 && (
                <option value="">No models found</option>
              )}
              {models.map(model => (
                <option key={model.name} value={model.name}>
                  {model.name} ({formatBytes(model.size)})
                </option>
              ))}
            </select>
            <p className="text-[9px] text-ghost-text-muted opacity-60">
              Install models with: <code className="bg-ghost-fill-strong px-1 rounded">ollama pull llama3.2</code>
            </p>
            <label htmlFor="context-length" className="text-[10px] text-ghost-text-muted uppercase tracking-wider block pt-1">
              Context window
            </label>
            <select
              id="context-length"
              value={localSettings.contextLength}
              onChange={e => setLocalSettings(prev => ({ ...prev, contextLength: parseInt(e.target.value) }))}
              className={SELECT_CLASS}
            >
              {CONTEXT_LENGTH_OPTIONS.map(n => (
                <option key={n} value={n}>{n.toLocaleString('en-US')} tokens</option>
              ))}
            </select>
            <p className="text-[9px] text-ghost-text-muted opacity-60">
              Tokens the model sees per request (chat history + transcript). Larger = more memory and slower replies. Older transcript is summarized automatically to fit.
            </p>
            <label className="flex items-center gap-2 pt-1 text-xs text-ghost-text cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.reasoning}
                onChange={e => {
                  const reasoning = e.target.checked
                  setLocalSettings(prev => ({ ...prev, reasoning }))
                }}
                className="accent-ghost-accent"
              />
              Reasoning
            </label>
            <p className="text-[9px] text-ghost-text-muted opacity-60">
              {selectedModelInfo && !supportsThinking(selectedModelInfo)
                ? 'This model does not reason, so this has no effect on it.'
                : 'Thinking models (e.g. qwen3) reason before answering: better answers, but much slower. The reasoning is shown above the reply. Turn off for fast suggestions.'}
            </p>
          </div>
        </Section>

        {/* Presets */}
        <Section title="Presets">
          <div className="space-y-2">
            <label htmlFor="active-preset" className="text-[10px] text-ghost-text-muted uppercase tracking-wider block">
              Active preset
            </label>
            <select
              id="active-preset"
              value={activePreset.id}
              onChange={e => {
                const activePresetId = e.target.value
                editPresets(presets => ({ presets, activePresetId }))
              }}
              className={SELECT_CLASS}
            >
              {localSettings.presets.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{isBuiltInPreset(p.id) ? ' (built-in)' : ''}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => editPresets(presets => {
                  const r = createPreset(presets)
                  return { presets: r.presets, activePresetId: r.id }
                })}
                className={SMALL_BUTTON_CLASS}
              >
                New
              </button>
              <button
                onClick={() => editPresets((presets, activeId) => {
                  const r = duplicatePreset(presets, activeId)
                  return r ? { presets: r.presets, activePresetId: r.id } : { presets }
                })}
                className={SMALL_BUTTON_CLASS}
              >
                Duplicate
              </button>
              {activeIsBuiltIn ? (
                <button
                  onClick={() => editPresets((presets, activeId) => ({ presets: restorePreset(presets, activeId) }))}
                  className={SMALL_BUTTON_CLASS}
                  title="Put this built-in preset back to its original prompts and quick actions"
                >
                  Restore defaults
                </button>
              ) : (
                <button
                  onClick={() => editPresets((presets, activeId) => {
                    const remaining = deletePreset(presets, activeId)
                    return { presets: remaining, activePresetId: remaining[0]?.id }
                  })}
                  className={`${SMALL_BUTTON_CLASS} hover:text-ghost-error`}
                >
                  Delete
                </button>
              )}
            </div>

            <label htmlFor="preset-name" className="text-[10px] text-ghost-text-muted uppercase tracking-wider block pt-1">
              Name
            </label>
            <input
              id="preset-name"
              type="text"
              value={activePreset.name}
              onChange={e => editActivePreset({ name: e.target.value })}
              className="w-full bg-ghost-fill border border-ghost-border rounded-lg px-3 py-1.5 text-xs text-ghost-text focus:outline-none focus:border-ghost-accent focus:ring-2 focus:ring-ghost-accent/30 transition-colors"
            />

            <label htmlFor="preset-system-prompt" className="text-[10px] text-ghost-text-muted uppercase tracking-wider block pt-1">
              System prompt
            </label>
            <textarea
              id="preset-system-prompt"
              value={activePreset.systemPrompt}
              onChange={e => editActivePreset({ systemPrompt: e.target.value })}
              rows={6}
              className={TEXTAREA_CLASS}
              placeholder="Instructions for the assistant..."
            />

            <label htmlFor="preset-suggest-reply" className="text-[10px] text-ghost-text-muted uppercase tracking-wider block pt-1">
              Suggest reply prompt
            </label>
            <textarea
              id="preset-suggest-reply"
              value={activePreset.suggestReplyPrompt}
              onChange={e => editActivePreset({ suggestReplyPrompt: e.target.value })}
              rows={4}
              className={TEXTAREA_CLASS}
              placeholder="Prompt sent when using Suggest Reply or Auto..."
            />
            <p className="text-[9px] text-ghost-text-muted opacity-60">
              Use <code className="bg-ghost-fill-strong px-1 rounded">{'{{transcript}}'}</code> as placeholder for the transcribed text. This prompt is used by the Suggest Reply button and Auto mode (which sends only what was said since its last send).
            </p>

            <div className="text-[10px] text-ghost-text-muted uppercase tracking-wider pt-1">Quick actions</div>
            <div className="space-y-1.5">
              {activePreset.quickActions.map((action, i) => (
                <div key={i} className="flex gap-1 items-start">
                  <input
                    type="text"
                    aria-label={`Quick action ${i + 1} label`}
                    value={action.label}
                    onChange={e => editActivePreset({
                      quickActions: activePreset.quickActions.map((qa, j) => (j === i ? { ...qa, label: e.target.value } : qa)),
                    })}
                    placeholder="Label"
                    className="w-24 flex-shrink-0 bg-ghost-fill border border-ghost-border rounded-lg px-2 py-1 text-[10px] text-ghost-text focus:outline-none focus:border-ghost-accent transition-colors"
                  />
                  <textarea
                    aria-label={`Quick action ${i + 1} prompt`}
                    value={action.prompt}
                    onChange={e => editActivePreset({
                      quickActions: activePreset.quickActions.map((qa, j) => (j === i ? { ...qa, prompt: e.target.value } : qa)),
                    })}
                    rows={2}
                    placeholder="Prompt sent to the model"
                    className="flex-1 min-w-0 bg-ghost-fill border border-ghost-border rounded-lg px-2 py-1 text-[10px] text-ghost-text focus:outline-none focus:border-ghost-accent transition-colors resize-none"
                  />
                  <button
                    onClick={() => editActivePreset({ quickActions: activePreset.quickActions.filter((_, j) => j !== i) })}
                    className="p-1 rounded text-ghost-text-muted hover:text-ghost-error hover:bg-ghost-fill-strong transition-colors"
                    title="Remove quick action"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => editActivePreset({ quickActions: [...activePreset.quickActions, { label: 'New action', prompt: '' }] })}
                className={SMALL_BUTTON_CLASS}
              >
                + Add quick action
              </button>
            </div>
            <p className="text-[9px] text-ghost-text-muted opacity-60">
              Quick actions appear above the chat input. The live transcript is sent along as context.
            </p>
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-ghost-text-muted uppercase tracking-wider mb-1 block">
                Opacity: {Math.round(localSettings.opacity * 100)}%
              </label>
              <input
                type="range"
                min="0.3"
                max="1"
                step="0.05"
                value={localSettings.opacity}
                onChange={e => {
                  const opacity = parseFloat(e.target.value)
                  setLocalSettings(prev => ({ ...prev, opacity }))
                  window.ghostAPI.setOpacity(opacity)
                }}
                className="w-full accent-ghost-accent"
              />
            </div>
            <div>
              <label className="text-[10px] text-ghost-text-muted uppercase tracking-wider mb-1 block">
                Font size: {localSettings.fontSize}px
              </label>
              <input
                type="range"
                min="10"
                max="30"
                step="1"
                value={localSettings.fontSize}
                onChange={e => {
                  const fontSize = parseInt(e.target.value)
                  setLocalSettings(prev => ({ ...prev, fontSize }))
                  document.documentElement.style.setProperty('--ghost-font-size', `${fontSize}px`)
                }}
                className="w-full accent-ghost-accent"
              />
            </div>
          </div>
        </Section>

        {/* Transcription */}
        <Section title="Transcription">
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="whisper-model" className="text-[10px] text-ghost-text-muted uppercase tracking-wider block">
                Whisper model
              </label>
              <select
                id="whisper-model"
                value={localSettings.whisperModel}
                onChange={e => {
                  const whisperModel = e.target.value
                  setLocalSettings(prev => ({ ...prev, whisperModel }))
                }}
                className={SELECT_CLASS}
              >
                {WHISPER_MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {formatModelSize(m.sizeMB)}
                  </option>
                ))}
              </select>
              <p className="text-[9px] text-ghost-text-muted opacity-60">
                Larger models are more accurate but slower. Downloaded once on first use and cached locally. Changing the model reloads Whisper (after the current recording stops).
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="transcription-language" className="text-[10px] text-ghost-text-muted uppercase tracking-wider block">
                Language
              </label>
              <select
                id="transcription-language"
                value={localSettings.transcriptionLanguage}
                onChange={e => {
                  const transcriptionLanguage = e.target.value
                  setLocalSettings(prev => ({ ...prev, transcriptionLanguage }))
                }}
                className={SELECT_CLASS}
              >
                {TRANSCRIPTION_LANGUAGES.map(l => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
              <p className="text-[9px] text-ghost-text-muted opacity-60">
                {englishOnlyWhisper
                  ? 'English-only model: it always transcribes English and ignores this setting. Pick a multilingual model for other languages.'
                  : 'Language spoken in the audio. Auto-detect works per phrase and can misfire on short phrases; pick the language when you know it.'}
              </p>
            </div>
            <div>
              <label className="text-[10px] text-ghost-text-muted uppercase tracking-wider mb-1 block">
                Max phrase length: {localSettings.transcriptionInterval}s
              </label>
              <input
                type="range"
                min="3"
                max="30"
                step="1"
                value={localSettings.transcriptionInterval}
                onChange={e => {
                  const transcriptionInterval = parseInt(e.target.value)
                  setLocalSettings(prev => ({ ...prev, transcriptionInterval }))
                }}
                className="w-full accent-ghost-accent"
              />
              <p className="text-[9px] text-ghost-text-muted opacity-60 mt-1">
                Maximum length of a transcribed phrase (3s to 30s). Speech is sent to Whisper at each natural pause, or after this long if nobody pauses. Applies to a recording already in progress.
              </p>
            </div>
            <div>
              <label className="text-[10px] text-ghost-text-muted uppercase tracking-wider mb-1 block">
                Speaker separation: {(localSettings.speakerThreshold ?? 0.85).toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.01"
                value={localSettings.speakerThreshold ?? 0.85}
                onChange={e => {
                  const speakerThreshold = parseFloat(e.target.value)
                  setLocalSettings(prev => ({ ...prev, speakerThreshold }))
                }}
                className="w-full accent-ghost-accent"
              />
              <p className="text-[9px] text-ghost-text-muted opacity-60 mt-1">
                Sensitivity for the "Speakers" mode (A/B/C). Higher = separates more speakers; lower = merges similar voices into one. Default 0.85.
              </p>
            </div>
          </div>
        </Section>

        {/* Keyboard Shortcuts */}
        <Section title="Shortcuts">
          <div className="space-y-1.5">
            {SHORTCUT_ACTIONS.map(({ id, label }) => (
              <ShortcutRecorder
                key={id}
                label={label}
                value={localSettings.shortcuts[id]}
                isMac={isMac}
                error={shortcutError(id)}
                onChange={accelerator => setLocalSettings(prev => ({
                  ...prev,
                  shortcuts: { ...prev.shortcuts, [id]: accelerator },
                }))}
              />
            ))}
            <div className="flex items-center justify-between pt-1">
              <p className="text-[9px] text-ghost-text-muted opacity-60">
                Click a shortcut, then press the new keys (Esc cancels). Esc in the chat clears the input / stops a reply.
              </p>
              <button
                onClick={() => setLocalSettings(prev => ({ ...prev, shortcuts: { ...DEFAULT_SHORTCUTS } }))}
                className="flex-shrink-0 ml-2 text-[10px] text-ghost-accent hover:text-ghost-accent-hover transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </Section>

        {/* Privacy */}
        <Section title="Privacy">
          <label className="flex items-center gap-2 mb-1 text-xs text-ghost-text cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.hideFromScreenShare}
              onChange={e => {
                const hideFromScreenShare = e.target.checked
                setLocalSettings(prev => ({ ...prev, hideFromScreenShare }))
              }}
              className="accent-ghost-accent"
            />
            Hide from screen sharing
          </label>
          <p className="text-[9px] text-ghost-text-muted opacity-60 mb-2">
            The overlay stays invisible in screen shares, recordings and screenshots taken by other apps (and by Ghost AI's own screenshots).
          </p>
          <div className="bg-ghost-success/10 border border-ghost-success/20 rounded-lg p-3">
            <p className="text-[10px] text-ghost-success leading-relaxed">
              Ghost AI is 100% local and anonymous. No data is sent to external servers.
              All conversations stay only on your machine.
              There is no telemetry, analytics, or tracking of any kind.
            </p>
          </div>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="text-[10px] text-ghost-text-muted space-y-1">
            <p>Ghost AI v1.0.0</p>
            <p>Local anonymous AI assistant</p>
            <p>Powered by Ollama</p>
            <p className="opacity-60 mt-2">MIT License - Open source</p>
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-ghost-text mb-2">{title}</h3>
      {children}
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-ghost-text-muted uppercase tracking-wider">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-ghost-fill border border-ghost-border rounded-lg px-3 py-1.5 text-xs text-ghost-text placeholder-ghost-text-muted/50 focus:outline-none focus:border-ghost-accent focus:ring-2 focus:ring-ghost-accent/30 transition-colors"
      />
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
