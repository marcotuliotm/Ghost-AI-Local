import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { HelpPanel } from '../components/HelpPanel'

describe('HelpPanel', () => {
  const defaultProps = {
    onBack: vi.fn(),
  }

  describe('rendering', () => {
    it('should show Help title', () => {
      render(<HelpPanel {...defaultProps} />)
      // "Help" appears as both header text and a ButtonRow label
      const helpElements = screen.getAllByText('Help')
      expect(helpElements.length).toBeGreaterThanOrEqual(1)
    })

    it('should show Keyboard Shortcuts section', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })

    it('should show Title Bar Buttons section', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Title Bar Buttons')).toBeInTheDocument()
    })

    it('should show Audio Buttons section', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Audio Buttons')).toBeInTheDocument()
    })

    it('should show Quick Actions section', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Quick Actions (Chat)')).toBeInTheDocument()
    })
  })

  describe('keyboard shortcuts', () => {
    it('should list Cmd+Shift+G shortcut', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Cmd+Shift+G')).toBeInTheDocument()
    })

    it('should list Cmd+Shift+S shortcut', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Cmd+Shift+S')).toBeInTheDocument()
    })

    it('should list Cmd+Shift+A shortcut', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Cmd+Shift+A')).toBeInTheDocument()
    })

    it('should show Show/Hide overlay description', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Show/Hide overlay')).toBeInTheDocument()
    })

    it('should show Capture screenshot description', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Capture screenshot & analyze')).toBeInTheDocument()
    })
  })

  describe('audio buttons documentation', () => {
    it('should document Translate PT button', () => {
      render(<HelpPanel {...defaultProps} />)
      // "Translate PT" appears as both icon span text and ButtonRow label
      const translateElements = screen.getAllByText('Translate PT')
      expect(translateElements.length).toBeGreaterThanOrEqual(1)
    })

    it('should document Auto button', () => {
      render(<HelpPanel {...defaultProps} />)
      // "Auto" appears in audio buttons section
      const autoElements = screen.getAllByText('Auto')
      expect(autoElements.length).toBeGreaterThan(0)
    })

    it('should document Auto Interval control', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Auto Interval (10-120s)')).toBeInTheDocument()
    })

    it('should document Summarize button', () => {
      render(<HelpPanel {...defaultProps} />)
      const summarizeElements = screen.getAllByText('Summarize')
      expect(summarizeElements.length).toBeGreaterThan(0)
    })

    it('should document Save button', () => {
      render(<HelpPanel {...defaultProps} />)
      const saveElements = screen.getAllByText('Save')
      expect(saveElements.length).toBeGreaterThan(0)
    })

    it('should document Clear button', () => {
      render(<HelpPanel {...defaultProps} />)
      const clearElements = screen.getAllByText('Clear')
      expect(clearElements.length).toBeGreaterThan(0)
    })
  })

  describe('title bar buttons documentation', () => {
    it('should document Screenshot buttons', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Screenshot (Full)')).toBeInTheDocument()
      expect(screen.getByText('Screenshot (Crop)')).toBeInTheDocument()
    })

    it('should document Settings button', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })

    it('should document Minimize button', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Minimize')).toBeInTheDocument()
    })

    it('should document Save Conversation', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Save Conversation')).toBeInTheDocument()
    })

    it('should document Clear Chat', () => {
      render(<HelpPanel {...defaultProps} />)
      expect(screen.getByText('Clear Chat')).toBeInTheDocument()
    })
  })

  describe('navigation', () => {
    it('should call onBack when back button is clicked', () => {
      const onBack = vi.fn()
      render(<HelpPanel onBack={onBack} />)

      // The back button is the first button in the header
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      expect(onBack).toHaveBeenCalledTimes(1)
    })
  })
})
