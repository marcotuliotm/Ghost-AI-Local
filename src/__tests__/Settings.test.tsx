import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SettingsPanel } from '../components/Settings'
import type { Settings, OllamaModel } from '../types'
import { makeSettings } from './fixtures'
import { BUILTIN_PRESETS } from '../lib/presets'

const defaultSettings: Settings = makeSettings({
  ollamaBaseUrl: 'http://localhost:11434',
  selectedModel: 'gemma4:latest',
  systemPrompt: 'You are Ghost AI.',
  suggestReplyPrompt: 'The other person said: "{{transcript}}"\n\nSuggest a natural response.',
  opacity: 0.9,
  fontSize: 12,
  transcriptionInterval: 10,
  speakerThreshold: 0.85,
  contextLength: 8192,
})

const defaultModels: OllamaModel[] = [
  { name: 'gemma4:latest', size: 8000000000, digest: 'abc', modified_at: '2024-01-01' },
  { name: 'llama3:8b', size: 4000000000, digest: 'def', modified_at: '2024-01-02' },
]

const defaultProps = {
  settings: defaultSettings,
  models: defaultModels,
  isConnected: true,
  onUpdateSettings: vi.fn(),
  onBack: vi.fn(),
  onRefreshModels: vi.fn().mockResolvedValue([]),
  onCheckConnection: vi.fn().mockResolvedValue(true),
}

describe('SettingsPanel', () => {
  describe('context window', () => {
    it('should save the selected context length', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.change(screen.getByLabelText('Context window'), { target: { value: '16384' } })
      fireEvent.click(screen.getByText('Save'))
      expect(onUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ contextLength: 16384 }))
    })
  })

  describe('unsaved previews', () => {
    it('should restore the saved opacity when leaving without saving', () => {
      const onBack = vi.fn()
      render(<SettingsPanel {...defaultProps} onBack={onBack} />)
      const slider = screen.getAllByRole('slider')[0]
      fireEvent.change(slider, { target: { value: '0.5' } })
      expect(window.ghostAPI.setOpacity).toHaveBeenLastCalledWith(0.5)

      fireEvent.click(screen.getAllByRole('button')[0]) // back arrow
      expect(window.ghostAPI.setOpacity).toHaveBeenLastCalledWith(0.9)
      expect(onBack).toHaveBeenCalled()
    })
  })

  describe('rendering', () => {
    it('should show Settings title', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })

    it('should show Connected status when connected', () => {
      render(<SettingsPanel {...defaultProps} isConnected={true} />)
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('should show Disconnected status when not connected', () => {
      render(<SettingsPanel {...defaultProps} isConnected={false} />)
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
    })

    it('should show Ollama URL input', () => {
      render(<SettingsPanel {...defaultProps} />)
      const input = screen.getByDisplayValue('http://localhost:11434')
      expect(input).toBeInTheDocument()
    })

    it('should show model dropdown with models', () => {
      render(<SettingsPanel {...defaultProps} />)
      const select = screen.getByDisplayValue(/gemma4:latest/)
      expect(select).toBeInTheDocument()
    })

    it('should show the active preset system prompt', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByLabelText('System prompt')).toHaveValue('You are Ghost AI.')
    })

    it('should show the active preset suggest reply prompt', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByLabelText('Suggest reply prompt')).toHaveValue(defaultSettings.presets[0].suggestReplyPrompt)
    })

    it('should show {{transcript}} documentation', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText('{{transcript}}')).toBeInTheDocument()
    })

    it('should show opacity slider', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText(/Opacity: 90%/)).toBeInTheDocument()
    })

    it('should show transcription interval', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText(/Max phrase length: 10s/)).toBeInTheDocument()
    })

    it('should show speaker separation slider', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText(/Speaker separation: 0.85/)).toBeInTheDocument()
    })

    it('should show keyboard shortcuts', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText('Shortcuts')).toBeInTheDocument()
      expect(screen.getByText('Cmd+Shift+G')).toBeInTheDocument()
    })

    it('should show privacy section', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText('Privacy')).toBeInTheDocument()
      expect(screen.getByText(/100% local and anonymous/)).toBeInTheDocument()
    })

    it('should show about section', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText('About')).toBeInTheDocument()
      expect(screen.getByText('Ghost AI v1.0.0')).toBeInTheDocument()
    })
  })

  describe('actions', () => {
    it('should call onBack when back button is clicked', () => {
      const onBack = vi.fn()
      render(<SettingsPanel {...defaultProps} onBack={onBack} />)

      const buttons = screen.getAllByRole('button')
      // First button is the back arrow
      fireEvent.click(buttons[0])
      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call onUpdateSettings and onBack when Save is clicked', () => {
      const onUpdateSettings = vi.fn()
      const onBack = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} onBack={onBack} />)

      fireEvent.click(screen.getByText('Save'))
      expect(onUpdateSettings).toHaveBeenCalledTimes(1)
      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call onCheckConnection when Check is clicked', async () => {
      const onCheckConnection = vi.fn().mockResolvedValue(true)
      const onRefreshModels = vi.fn().mockResolvedValue([])
      render(
        <SettingsPanel
          {...defaultProps}
          onCheckConnection={onCheckConnection}
          onRefreshModels={onRefreshModels}
        />
      )

      fireEvent.click(screen.getByText('Check'))
      expect(onCheckConnection).toHaveBeenCalled()
    })

    it('should save updated settings', async () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)

      // Change the system prompt
      const textarea = screen.getByDisplayValue('You are Ghost AI.')
      await userEvent.clear(textarea)
      await userEvent.type(textarea, 'New prompt')

      fireEvent.click(screen.getByText('Save'))

      const saved = onUpdateSettings.mock.calls[0][0]
      expect(saved.presets.find((p: any) => p.id === 'general').systemPrompt).toBe('New prompt')
    })
  })

  describe('presets', () => {
    const saved = (fn: any) => fn.mock.calls.at(-1)[0] as Settings

    it('should list the presets with the active one selected', () => {
      render(<SettingsPanel {...defaultProps} />)
      const select = screen.getByLabelText('Active preset') as HTMLSelectElement
      expect(select.value).toBe('general')
      expect(Array.from(select.options).map(o => o.textContent)).toEqual([
        'General (built-in)', 'Technical interview (built-in)', 'Sales call (built-in)', 'Lecture/Class (built-in)',
      ])
    })

    it('should switch which preset is edited and active', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.change(screen.getByLabelText('Active preset'), { target: { value: 'lecture' } })
      expect(screen.getByLabelText('Name')).toHaveValue('Lecture/Class')
      fireEvent.click(screen.getByText('Save'))
      expect(saved(onUpdateSettings).activePresetId).toBe('lecture')
    })

    it('should not offer Delete for built-in presets, only Restore defaults', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.queryByText('Delete')).toBeNull()
      expect(screen.getByText('Restore defaults')).toBeInTheDocument()
    })

    it('should restore an edited built-in preset', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
      fireEvent.click(screen.getByText('Restore defaults'))
      expect(screen.getByLabelText('Name')).toHaveValue('General')
      expect(screen.getByLabelText('System prompt')).toHaveValue(BUILTIN_PRESETS[0].systemPrompt)
    })

    it('should create, rename and delete a user preset', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.click(screen.getByText('New'))
      expect(screen.getByLabelText('Name')).toHaveValue('New preset')

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Standup' } })
      expect(screen.getByRole('option', { name: 'Standup' })).toBeInTheDocument()

      fireEvent.click(screen.getByText('Delete'))
      expect(screen.queryByRole('option', { name: 'Standup' })).toBeNull()
      expect((screen.getByLabelText('Active preset') as HTMLSelectElement).value).toBe('general')

      fireEvent.click(screen.getByText('Save'))
      expect(saved(onUpdateSettings).presets).toHaveLength(BUILTIN_PRESETS.length)
    })

    it('should duplicate the active preset and save it as active', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.change(screen.getByLabelText('Active preset'), { target: { value: 'sales-call' } })
      fireEvent.click(screen.getByText('Duplicate'))
      expect(screen.getByLabelText('Name')).toHaveValue('Sales call copy')

      fireEvent.click(screen.getByText('Save'))
      const s = saved(onUpdateSettings)
      const copy = s.presets.find(p => p.id === s.activePresetId)!
      expect(copy.name).toBe('Sales call copy')
      expect(copy.quickActions).toEqual(BUILTIN_PRESETS[2].quickActions)
    })

    it('should edit, add and remove quick actions', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.change(screen.getByLabelText('Quick action 1 label'), { target: { value: 'TL;DR' } })
      fireEvent.click(screen.getAllByTitle('Remove quick action')[2]) // drop "Next steps"
      fireEvent.click(screen.getByText('+ Add quick action'))
      fireEvent.change(screen.getByLabelText('Quick action 3 prompt'), { target: { value: 'Any risks?' } })

      fireEvent.click(screen.getByText('Save'))
      expect(saved(onUpdateSettings).presets[0].quickActions).toEqual([
        { label: 'TL;DR', prompt: 'Summarize the conversation so far in key points.' },
        { label: 'Suggest reply', prompt: 'Based on the context, suggest what I should respond now.' },
        { label: 'New action', prompt: 'Any risks?' },
      ])
    })

    it('should discard preset edits when leaving without saving', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.click(screen.getByText('New'))
      fireEvent.click(screen.getAllByRole('button')[0]) // back
      expect(onUpdateSettings).not.toHaveBeenCalled()
    })
  })

  describe('whisper', () => {
    it('should list the Whisper models with their download size', () => {
      render(<SettingsPanel {...defaultProps} />)
      const select = screen.getByLabelText('Whisper model') as HTMLSelectElement
      expect(select.value).toBe('onnx-community/whisper-base')
      expect(screen.getByRole('option', { name: 'Base (multilingual) — ~290 MB' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Small (English only) — ~970 MB' })).toBeInTheDocument()
    })

    it('should save the Whisper model and transcription language', () => {
      const onUpdateSettings = vi.fn()
      render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />)
      fireEvent.change(screen.getByLabelText('Whisper model'), { target: { value: 'onnx-community/whisper-small' } })
      fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'portuguese' } })
      fireEvent.click(screen.getByText('Save'))
      expect(onUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
        whisperModel: 'onnx-community/whisper-small',
        transcriptionLanguage: 'portuguese',
      }))
    })

    it('should explain that English-only models ignore the language', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.queryByText(/English-only model/)).toBeNull()
      fireEvent.change(screen.getByLabelText('Whisper model'), { target: { value: 'onnx-community/whisper-base.en' } })
      expect(screen.getByText(/English-only model/)).toBeInTheDocument()
    })
  })
})
