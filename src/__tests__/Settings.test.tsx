import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SettingsPanel } from '../components/Settings'
import type { Settings, OllamaModel } from '../types'

const defaultSettings: Settings = {
  ollamaBaseUrl: 'http://localhost:11434',
  selectedModel: 'gemma3:12b',
  systemPrompt: 'You are Ghost AI.',
  suggestReplyPrompt: 'The other person said: "{{transcript}}"\n\nSuggest a natural response.',
  opacity: 0.9,
  language: 'pt-BR',
  transcriptionInterval: 10,
}

const defaultModels: OllamaModel[] = [
  { name: 'gemma3:12b', size: 8000000000, digest: 'abc', modified_at: '2024-01-01' },
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
      const select = screen.getByDisplayValue(/gemma3:12b/)
      expect(select).toBeInTheDocument()
    })

    it('should show system prompt textarea', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText('System Prompt')).toBeInTheDocument()
      expect(screen.getByDisplayValue('You are Ghost AI.')).toBeInTheDocument()
    })

    it('should show suggest reply prompt section', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByText('Suggest Reply Prompt')).toBeInTheDocument()
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
      expect(screen.getByText(/Transcription interval: 10s/)).toBeInTheDocument()
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

      expect(onUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'New prompt',
        })
      )
    })
  })
})
