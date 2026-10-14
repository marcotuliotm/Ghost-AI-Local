import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ShortcutRecorder } from '../components/ShortcutRecorder'

const setup = (props: Partial<React.ComponentProps<typeof ShortcutRecorder>> = {}) => {
  const onChange = vi.fn()
  render(<ShortcutRecorder label="Show/Hide overlay" value="CommandOrControl+Shift+G" onChange={onChange} isMac={true} {...props} />)
  return { onChange, button: screen.getByLabelText('Shortcut for Show/Hide overlay') }
}

describe('ShortcutRecorder', () => {
  it('should show the current shortcut', () => {
    const { button } = setup()
    expect(button).toHaveTextContent('Cmd+Shift+G')
  })

  it('should record a new combination and suspend global shortcuts meanwhile', () => {
    const { onChange, button } = setup()
    fireEvent.click(button)
    expect(button).toHaveTextContent('Press keys...')
    expect(window.ghostAPI.suspendShortcuts).toHaveBeenLastCalledWith(true)

    fireEvent.keyDown(button, { key: 'Meta', code: 'MetaLeft', metaKey: true })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(button, { key: 'k', code: 'KeyK', metaKey: true, altKey: true })
    expect(onChange).toHaveBeenCalledWith('CommandOrControl+Alt+K')
    expect(window.ghostAPI.suspendShortcuts).toHaveBeenLastCalledWith(false)
  })

  it('should ask for a modifier when a bare key is pressed', () => {
    const { onChange, button } = setup()
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'k', code: 'KeyK' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Add Cmd, Ctrl or Option')).toBeInTheDocument()
  })

  it('should cancel with Esc', () => {
    const { onChange, button } = setup()
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Escape', code: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(button).toHaveTextContent('Cmd+Shift+G')
    expect(window.ghostAPI.suspendShortcuts).toHaveBeenLastCalledWith(false)
  })

  it('should show an error', () => {
    setup({ error: 'In use by another app' })
    expect(screen.getByText('In use by another app')).toBeInTheDocument()
  })
})
