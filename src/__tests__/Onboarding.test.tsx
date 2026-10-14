import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Onboarding } from '../components/Onboarding'
import { makeSettings } from './fixtures'

const models = [{ name: 'gemma4:latest', size: 1, digest: 'a', modified_at: '' }]

const setup = (props: Partial<React.ComponentProps<typeof Onboarding>> = {}) => {
  const onDone = vi.fn()
  const updateSettings = vi.fn()
  const checkConnection = vi.fn().mockResolvedValue(true)
  render(<Onboarding
    isConnected={true} connectionError={null} models={models} settings={makeSettings()}
    updateSettings={updateSettings} checkConnection={checkConnection} onDone={onDone} {...props}
  />)
  return { onDone, updateSettings, checkConnection }
}

const isDone = (id: string) => within(screen.getByTestId(`setup-${id}`)).queryByLabelText('Done') !== null

describe('Onboarding', () => {
  it('should show what is ready and let the user finish', async () => {
    window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready', model: 'onnx-community/whisper-base' })
    const { onDone } = setup()
    await waitFor(() => expect(isDone('whisper')).toBe(true))
    expect(isDone('ollama')).toBe(true)
    expect(isDone('model')).toBe(true)
    await waitFor(() => expect(isDone('screen')).toBe(true))
    expect(screen.getByText('All set.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Finish'))
    expect(onDone).toHaveBeenCalled()
  })

  it('should explain how to start Ollama and block Finish until it runs', async () => {
    const { checkConnection } = setup({ isConnected: false, models: [] })
    expect(screen.getByText('ollama serve')).toBeInTheDocument()
    expect(screen.getByText('Finish')).toBeDisabled()
    fireEvent.click(screen.getByText('Check again', { selector: '[data-testid="setup-ollama"] button' }))
    await waitFor(() => expect(checkConnection).toHaveBeenCalled())
  })

  it('should show a non-local URL error from the connection check', () => {
    setup({ isConnected: false, models: [], connectionError: 'Only a local Ollama is allowed' })
    expect(screen.getByText('Only a local Ollama is allowed')).toBeInTheDocument()
  })

  it('should suggest a pull command (copyable) when no model is installed', async () => {
    setup({ models: [] })
    expect(screen.getByText('ollama pull gemma3:4b')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('setup-model')).getByTitle('Copy command'))
    await waitFor(() => expect(window.ghostAPI.copyText).toHaveBeenCalledWith('ollama pull gemma3:4b'))
  })

  it('should request the microphone, or open System Settings when denied', async () => {
    window.ghostAPI.getMicStatus = vi.fn().mockResolvedValue({ status: 'not-determined' })
    setup()
    fireEvent.click(await screen.findByText('Allow microphone'))
    await waitFor(() => expect(window.ghostAPI.requestMicPermission).toHaveBeenCalled())
  })

  it('should open the Screen Recording settings', async () => {
    window.ghostAPI.getScreenPermission = vi.fn().mockResolvedValue({ status: 'denied' })
    setup()
    await waitFor(() => expect(isDone('screen')).toBe(false))
    fireEvent.click(within(screen.getByTestId('setup-screen')).getByText('Open System Settings'))
    expect(window.ghostAPI.openPrivacySettings).toHaveBeenCalledWith('screen')
  })

  it('should not block Finish on the optional permissions', async () => {
    window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
    window.ghostAPI.getMicStatus = vi.fn().mockResolvedValue({ status: 'denied' })
    window.ghostAPI.getScreenPermission = vi.fn().mockResolvedValue({ status: 'denied' })
    setup()
    await waitFor(() => expect(screen.getByText('Finish')).not.toBeDisabled())
  })

  it('should change the Whisper model and allow skipping', () => {
    const { updateSettings, onDone } = setup()
    fireEvent.change(screen.getByLabelText('Whisper model'), { target: { value: 'onnx-community/whisper-small' } })
    expect(updateSettings).toHaveBeenCalledWith({ whisperModel: 'onnx-community/whisper-small' })
    fireEvent.click(screen.getByText('Skip'))
    expect(onDone).toHaveBeenCalled()
  })
})
