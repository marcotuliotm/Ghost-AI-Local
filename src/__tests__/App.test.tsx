import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import App from '../App'

// App uses useGhostAI which calls window.ghostAPI methods on mount.
// The setup.ts file mocks all ghostAPI methods.

describe('App', () => {
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
})
