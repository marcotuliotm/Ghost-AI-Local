import { useState, useEffect } from 'react'
import type { Settings, OllamaModel } from '../types'

interface SettingsPanelProps {
  settings: Settings
  models: OllamaModel[]
  isConnected: boolean
  onUpdateSettings: (settings: Partial<Settings>) => void
  onBack: () => void
  onRefreshModels: () => Promise<OllamaModel[]>
  onCheckConnection: () => Promise<boolean>
}

export function SettingsPanel({
  settings,
  models,
  isConnected,
  onUpdateSettings,
  onBack,
  onRefreshModels,
  onCheckConnection,
}: SettingsPanelProps) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  const handleSave = () => {
    onUpdateSettings(localSettings)
    onBack()
  }

  const handleCheckConnection = async () => {
    setIsChecking(true)
    await onCheckConnection()
    await onRefreshModels()
    setIsChecking(false)
  }

  return (
    <div className="w-full h-full flex flex-col glass rounded-2xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ghost-border drag-region">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-white/10 transition-colors no-drag"
          >
            <svg className="w-4 h-4 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-ghost-text">Settings</span>
        </div>
        <button
          onClick={handleSave}
          className="px-3 py-1 rounded-lg bg-ghost-accent hover:bg-ghost-accent-hover text-xs text-white transition-colors no-drag"
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
              className="w-full bg-white/5 border border-ghost-border rounded-lg px-3 py-1.5 text-xs text-ghost-text focus:outline-none focus:border-ghost-accent/50 transition-colors appearance-none"
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
              Install models with: <code className="bg-white/10 px-1 rounded">ollama pull llama3.2</code>
            </p>
          </div>
        </Section>

        {/* System Prompt */}
        <Section title="System Prompt">
          <textarea
            value={localSettings.systemPrompt}
            onChange={e => setLocalSettings(prev => ({ ...prev, systemPrompt: e.target.value }))}
            rows={6}
            className="w-full bg-white/5 border border-ghost-border rounded-lg px-3 py-2 text-xs text-ghost-text placeholder-ghost-text-muted/50 focus:outline-none focus:border-ghost-accent/50 transition-colors resize-none"
            placeholder="Instructions for the assistant..."
          />
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
          </div>
        </Section>

        {/* Transcription */}
        <Section title="Transcription">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-ghost-text-muted uppercase tracking-wider mb-1 block">
                Transcription interval: {localSettings.transcriptionInterval}s
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
                Time between each Whisper audio processing (3s to 30s). Lower values = more responsive, but uses more CPU.
              </p>
            </div>
          </div>
        </Section>

        {/* Keyboard Shortcuts */}
        <Section title="Shortcuts">
          <div className="space-y-1.5 text-xs text-ghost-text-muted">
            <ShortcutRow label="Show/Hide overlay" shortcut="Cmd+Shift+G" />
            <ShortcutRow label="Capture screenshot" shortcut="Cmd+Shift+S" />
            <ShortcutRow label="Focus input" shortcut="Cmd+Shift+A" />
          </div>
        </Section>

        {/* Privacy */}
        <Section title="Privacy">
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
        className="w-full bg-white/5 border border-ghost-border rounded-lg px-3 py-1.5 text-xs text-ghost-text placeholder-ghost-text-muted/50 focus:outline-none focus:border-ghost-accent/50 transition-colors"
      />
    </div>
  )
}

function ShortcutRow({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-mono">
        {shortcut}
      </kbd>
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
