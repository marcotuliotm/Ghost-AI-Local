import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import App from '../App'

// App uses useGhostAI which calls window.ghostAPI methods on mount.
// The setup.ts file mocks all ghostAPI methods.

describe('App', () => {
  describe('startup', () => {
    it('should apply the default opacity without opening Settings', async () => {
      render(<App />)
      await waitFor(() => {
        expect(window.ghostAPI.setOpacity).toHaveBeenCalledWith(0.9)
      })
    })
  })

  describe('routing', () => {
    it('should render overlay by default', async () => {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByText('Ghost AI')).toBeInTheDocument()
      })
    })

    it('should show welcome message on initial load', async () => {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByText(/Local Anonymous Assistant/)).toBeInTheDocument()
      })
    })

    it('should navigate to help and back', async () => {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByText('Ghost AI')).toBeInTheDocument()
      })

      // Click help button (? icon in title bar)
      const helpButton = screen.getByTitle('Help - Shortcuts & buttons')
      fireEvent.click(helpButton)

      // "Help" appears in both the header and as a ButtonRow label
      const helpElements = screen.getAllByText('Help')
      expect(helpElements.length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()

      // Click back - find the back button in the HelpPanel (not the hidden Overlay)
      // The HelpPanel back button is near the "Help" header text
      const helpHeader = helpElements.find(el => el.className.includes('text-sm'))!
      const helpBackButton = helpHeader.closest('.flex')!.querySelector('button')!
      fireEvent.click(helpBackButton)

      await waitFor(() => {
        // Overlay should be visible again (not hidden)
        expect(screen.getByText(/Local Anonymous Assistant/)).toBeInTheDocument()
      })
    })

    it('should navigate to settings and back', async () => {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByText('Ghost AI')).toBeInTheDocument()
      })

      // Click settings button
      const settingsButton = screen.getByTitle('Settings')
      fireEvent.click(settingsButton)

      expect(screen.getByText('Settings')).toBeInTheDocument()
      expect(screen.getByText('Ollama Connection')).toBeInTheDocument()

      // Find the Settings panel's back button (not the hidden Overlay's buttons)
      // The Settings header has "Settings" text; its sibling button is the back arrow
      const settingsHeader = screen.getByText('Settings')
      const settingsBackButton = settingsHeader.closest('.flex')!.querySelector('button')!
      fireEvent.click(settingsBackButton)

      await waitFor(() => {
        expect(screen.getByText(/Local Anonymous Assistant/)).toBeInTheDocument()
      })
    })

    it('should keep overlay mounted when on settings (hidden class)', async () => {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByText('Ghost AI')).toBeInTheDocument()
      })

      const settingsButton = screen.getByTitle('Settings')
      fireEvent.click(settingsButton)

      // Overlay wrapper should exist but have 'hidden' class
      const ghostText = screen.getByText('Ghost AI')
      const overlayWrapper = ghostText.closest('.hidden')
      expect(overlayWrapper).not.toBeNull()
    })
  })

  describe('screen sharing protection', () => {
    it('should hide the overlay from screen sharing at startup', async () => {
      render(<App />)
      await waitFor(() => expect(window.ghostAPI.setContentProtection).toHaveBeenCalledWith(true))
    })

    it('should apply a stored choice to show it', async () => {
      window.ghostAPI.settingsLoad = vi.fn().mockResolvedValue({ settings: { hideFromScreenShare: false } })
      render(<App />)
      await waitFor(() => expect(window.ghostAPI.setContentProtection).toHaveBeenLastCalledWith(false))
    })
  })

  describe('first-run setup', () => {
    it('should open the setup for a new user and remember when it is done', async () => {
      window.ghostAPI.settingsLoad = vi.fn().mockResolvedValue({ settings: null })
      render(<App />)
      expect(await screen.findByText('Welcome to Ghost AI')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Skip'))
      await waitFor(() => expect(window.ghostAPI.settingsSave).toHaveBeenLastCalledWith(expect.objectContaining({ onboardingCompleted: true })))
      expect(screen.queryByText('Welcome to Ghost AI')).toBeNull()
    })

    it('should not show the setup to existing users', async () => {
      window.ghostAPI.settingsLoad = vi.fn().mockResolvedValue({ settings: { selectedModel: 'gemma4:latest' } })
      render(<App />)
      await waitFor(() => expect(window.ghostAPI.settingsSave).toHaveBeenCalled())
      expect(screen.queryByText('Welcome to Ghost AI')).toBeNull()
    })

    it('should reopen the setup from Help', async () => {
      window.ghostAPI.settingsLoad = vi.fn().mockResolvedValue({ settings: { onboardingCompleted: true } })
      render(<App />)
      await waitFor(() => expect(window.ghostAPI.settingsSave).toHaveBeenCalled())
      fireEvent.click(screen.getByTitle('Help - Shortcuts & buttons'))
      fireEvent.click(screen.getByText('Run setup again'))
      expect(screen.getByText('Welcome to Ghost AI')).toBeInTheDocument()
    })
  })

  describe('compact mode', () => {
    it('should shrink to the compact card and back', async () => {
      window.ghostAPI.settingsLoad = vi.fn().mockResolvedValue({ settings: { onboardingCompleted: true } })
      render(<App />)
      await waitFor(() => expect(window.ghostAPI.settingsSave).toHaveBeenCalled())
      expect(window.ghostAPI.setCompactMode).toHaveBeenLastCalledWith(false)

      fireEvent.click(screen.getByTitle('Compact mode (Cmd+Shift+M)'))
      expect(screen.getByTestId('compact-view')).toBeInTheDocument()
      expect(window.ghostAPI.setCompactMode).toHaveBeenLastCalledWith(true)

      fireEvent.click(screen.getByTitle('Expand (Cmd+Shift+M)'))
      expect(screen.queryByTestId('compact-view')).toBeNull()
      expect(window.ghostAPI.setCompactMode).toHaveBeenLastCalledWith(false)
    })

    it('should toggle from the global shortcut', async () => {
      let toggle: () => void = () => {}
      window.ghostAPI.onToggleCompact = vi.fn().mockImplementation(cb => { toggle = cb; return () => {} })
      window.ghostAPI.settingsLoad = vi.fn().mockResolvedValue({ settings: { onboardingCompleted: true } })
      render(<App />)
      await waitFor(() => expect(window.ghostAPI.settingsSave).toHaveBeenCalled())
      act(() => toggle())
      expect(screen.getByTestId('compact-view')).toBeInTheDocument()
      act(() => toggle())
      expect(screen.queryByTestId('compact-view')).toBeNull()
    })
  })
})
