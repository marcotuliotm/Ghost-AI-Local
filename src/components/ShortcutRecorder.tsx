import { useCallback, useEffect, useState } from 'react'
import { acceleratorFromKeyEvent, formatAccelerator } from '../lib/shortcuts'

interface ShortcutRecorderProps {
  label: string
  value: string // Electron accelerator
  onChange: (accelerator: string) => void
  isMac: boolean
  error?: string
}

/**
 * Click, then press the new combination. Esc cancels. While recording, the
 * global shortcuts are suspended in the main process so pressing the current
 * combination doesn't trigger it.
 */
export function ShortcutRecorder({ label, value, onChange, isMac, error }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!recording) return
    window.ghostAPI.suspendShortcuts(true)
    return () => window.ghostAPI.suspendShortcuts(false)
  }, [recording])

  const stop = useCallback(() => {
    setRecording(false)
    setHint('')
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      stop()
      return
    }
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return // still holding modifiers
    const accelerator = acceleratorFromKeyEvent(e, isMac)
    if (!accelerator) {
      setHint(isMac ? 'Add Cmd, Ctrl or Option' : 'Add Ctrl or Alt')
      return
    }
    onChange(accelerator)
    stop()
  }, [recording, isMac, onChange, stop])

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-body text-ghost-text-muted">{label}</span>
      <div className="flex flex-col items-end">
        <button
          type="button"
          aria-label={`Shortcut for ${label}`}
          onClick={() => setRecording(r => !r)}
          onKeyDown={handleKeyDown}
          onBlur={stop}
          className={`min-w-[96px] px-1.5 py-0.5 rounded-full text-subhead font-mono transition-colors ${
            recording
              ? 'bg-ghost-accent/20 text-ghost-accent ring-1 ring-ghost-accent/50'
              : error
                ? 'bg-ghost-error/15 text-ghost-error'
                : 'bg-ghost-fill-strong text-ghost-text hover:bg-ghost-fill'
          }`}
        >
          {recording ? 'Press keys...' : formatAccelerator(value, isMac)}
        </button>
        {(hint || error) && (
          <span className={`text-footnote mt-0.5 ${hint ? 'text-ghost-text-muted' : 'text-ghost-error'}`}>{hint || error}</span>
        )}
      </div>
    </div>
  )
}
