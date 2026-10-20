import { useCallback, useEffect, useState } from 'react'
import type { OllamaModel, Settings } from '../types'
import { useWhisper } from '../hooks/useWhisper'
import { missingRequired, setupSteps, SUGGESTED_OLLAMA_MODEL, toPermissionStatus, type PermissionStatus, type SetupStep } from '../lib/onboarding'
import { formatModelSize, WHISPER_MODELS } from '../lib/whisper'

interface OnboardingProps {
  isConnected: boolean
  connectionError: string | null
  models: OllamaModel[]
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  checkConnection: () => Promise<boolean>
  // Finish or Skip: marks setup done and goes to the overlay
  onDone: () => void
}

// Permissions are changed in System Settings, outside the app: re-check while open
const PERMISSION_POLL_MS = 2000

async function copy(text: string) {
  try { await window.ghostAPI.copyText(text) } catch { /* ignore */ }
}

/**
 * First-run setup: Ollama + a local model, microphone and Screen Recording
 * access, and the Whisper model. Ghost AI never downloads Ollama models itself
 * (that would reach ollama.com); it shows the command to run instead.
 */
export function Onboarding({ isConnected, connectionError, models, settings, updateSettings, checkConnection, onDone }: OnboardingProps) {
  const [micStatus, setMicStatus] = useState<PermissionStatus>('unknown')
  const [screenStatus, setScreenStatus] = useState<PermissionStatus>('unknown')
  const [checking, setChecking] = useState(false)
  // Passive: the overlay's AudioCapture loads the model; this only reports progress
  const whisper = useWhisper(settings.whisperModel, settings.transcriptionLanguage)

  const refreshPermissions = useCallback(async () => {
    try {
      const [mic, scr] = await Promise.all([window.ghostAPI.getMicStatus(), window.ghostAPI.getScreenPermission()])
      setMicStatus(toPermissionStatus(mic?.status))
      setScreenStatus(toPermissionStatus(scr?.status))
    } catch { /* keep the last known status */ }
  }, [])

  useEffect(() => {
    refreshPermissions()
    const timer = setInterval(refreshPermissions, PERMISSION_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshPermissions])

  const handleCheckOllama = async () => {
    setChecking(true)
    try { await checkConnection() } finally { setChecking(false) }
  }

  const handleAllowMic = async () => {
    await window.ghostAPI.requestMicPermission()
    refreshPermissions()
  }

  const steps = setupSteps({
    ollamaConnected: isConnected,
    modelCount: models.length,
    micStatus,
    screenStatus,
    whisperStatus: whisper.status,
  })
  const blocking = missingRequired(steps)
  const step = (id: SetupStep['id']) => steps.find(s => s.id === id)!

  return (
    <div className="w-full h-full flex flex-col glass overflow-hidden animate-fade-in">
      <div className="toolbar">
        <span className="text-body font-semibold text-ghost-text">Welcome to Ghost AI</span>
        <button onClick={onDone} className="text-callout text-ghost-text-muted hover:text-ghost-text transition-colors no-drag">
          Skip
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 no-drag">
        <p className="text-callout text-ghost-text-muted leading-relaxed">
          Everything runs on this machine. A few things need to be in place first:
        </p>

        <Step step={step('ollama')}>
          {isConnected ? (
            <Hint>Connected to {settings.ollamaBaseUrl}</Hint>
          ) : (
            <>
              <Hint>{connectionError ?? 'Install Ollama from ollama.com, then start it:'}</Hint>
              <Command text="ollama serve" />
              <Action onClick={handleCheckOllama} disabled={checking}>{checking ? 'Checking...' : 'Check again'}</Action>
            </>
          )}
        </Step>

        <Step step={step('model')}>
          {models.length > 0 ? (
            <Hint>{models.length} local model{models.length === 1 ? '' : 's'} — using {settings.selectedModel}</Hint>
          ) : (
            <>
              <Hint>No local model yet. In a terminal, run:</Hint>
              <Command text={`ollama pull ${SUGGESTED_OLLAMA_MODEL}`} />
              <Action onClick={handleCheckOllama} disabled={checking || !isConnected}>Check again</Action>
            </>
          )}
        </Step>

        <Step step={step('microphone')}>
          {micStatus === 'granted' ? (
            <Hint>Allowed — your side of the conversation can be transcribed.</Hint>
          ) : (
            <>
              <Hint>Needed for the Mic and Both sources (your voice).</Hint>
              {micStatus === 'not-determined' || micStatus === 'unknown' ? (
                <Action onClick={handleAllowMic}>Allow microphone</Action>
              ) : (
                <Action onClick={() => window.ghostAPI.openPrivacySettings('microphone')}>Open System Settings</Action>
              )}
            </>
          )}
        </Step>

        <Step step={step('screen')}>
          {screenStatus === 'granted' ? (
            <Hint>Allowed — meeting audio and screenshots work.</Hint>
          ) : (
            <>
              <Hint>Needed to hear meetings/videos (System audio) and for screenshots. macOS asks on first use, or enable Ghost AI here (you may need to reopen the app):</Hint>
              <Action onClick={() => window.ghostAPI.openPrivacySettings('screen')}>Open System Settings</Action>
            </>
          )}
        </Step>

        <Step step={step('whisper')}>
          <label htmlFor="setup-whisper-model" className="sr-only">Whisper model</label>
          <select
            id="setup-whisper-model"
            value={settings.whisperModel}
            onChange={e => updateSettings({ whisperModel: e.target.value })}
            className="w-full bg-ghost-fill border border-ghost-border rounded-lg px-2 py-1 text-callout text-ghost-text focus:outline-none focus:border-ghost-accent appearance-none"
          >
            {WHISPER_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label} — {formatModelSize(m.sizeMB)}</option>
            ))}
          </select>
          {whisper.status === 'loading' && (
            <div className="mt-1 space-y-0.5">
              <Hint>{whisper.progressMessage || 'Downloading...'}</Hint>
              <div className="w-full bg-ghost-fill rounded-full h-1 overflow-hidden">
                <div className="bg-ghost-accent h-1 rounded-full transition-all duration-300" style={{ width: `${Math.max(5, whisper.progress)}%` }} />
              </div>
            </div>
          )}
          {whisper.status === 'error' && <Hint error>{whisper.error}</Hint>}
          {whisper.status === 'ready' && <Hint>Ready. Larger models are more accurate but slower.</Hint>}
        </Step>
      </div>

      <div className="px-4 py-2 border-t border-ghost-border flex items-center justify-between no-drag">
        <span className="text-subhead text-ghost-text-muted">
          {blocking.length === 0 ? 'All set.' : `${blocking.length} required step${blocking.length === 1 ? '' : 's'} left`}
        </span>
        <button
          onClick={onDone}
          disabled={blocking.length > 0}
          className="px-3 py-1 rounded-full bg-ghost-accent hover:bg-ghost-accent-hover text-body text-white transition-colors disabled:opacity-40 disabled:hover:bg-ghost-accent"
        >
          Finish
        </button>
      </div>
    </div>
  )
}

function Step({ step, children }: { step: SetupStep; children: React.ReactNode }) {
  return (
    <div className="flex gap-2" data-testid={`setup-${step.id}`}>
      <span
        className={`mt-0.5 w-3.5 h-3.5 flex-shrink-0 rounded-full flex items-center justify-center text-footnote ${
          step.done ? 'bg-ghost-success text-white' : 'border border-ghost-border text-ghost-text-muted'
        }`}
        aria-label={step.done ? 'Done' : 'Not done'}
      >
        {step.done ? '✓' : ''}
      </span>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-body text-ghost-text">
          {step.title}
          {step.optional && <span className="ml-1 text-subhead text-ghost-text-muted">(optional)</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

function Hint({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return <p className={`text-callout leading-relaxed ${error ? 'text-ghost-error' : 'text-ghost-text-muted'}`}>{children}</p>
}

function Command({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1">
      <code className="flex-1 bg-ghost-fill-strong px-1.5 py-0.5 rounded-full text-callout font-mono text-ghost-text select-text">{text}</code>
      <button onClick={() => copy(text)} className="text-subhead text-ghost-accent hover:text-ghost-accent-hover" title="Copy command">
        Copy
      </button>
    </div>
  )
}

function Action({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-0.5 rounded-full text-callout bg-ghost-fill text-ghost-text hover:bg-ghost-fill-strong transition-colors disabled:opacity-40"
    >
      {children}
    </button>
  )
}
