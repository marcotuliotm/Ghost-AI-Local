import { describe, it, expect } from 'vitest'
import { missingRequired, setupSteps, toPermissionStatus } from '../lib/onboarding'

const ready = { ollamaConnected: true, modelCount: 2, micStatus: 'granted' as const, screenStatus: 'granted' as const, whisperStatus: 'ready' as const }

describe('setup steps', () => {
  it('should be complete when everything is in place', () => {
    expect(setupSteps(ready).every(s => s.done)).toBe(true)
    expect(missingRequired(setupSteps(ready))).toEqual([])
  })

  it('should require Ollama, a model and Whisper, but not the permissions', () => {
    const steps = setupSteps({ ...ready, micStatus: 'denied', screenStatus: 'not-determined' })
    expect(missingRequired(steps)).toEqual([])
    expect(steps.filter(s => !s.done).map(s => s.id)).toEqual(['microphone', 'screen'])

    const missing = missingRequired(setupSteps({ ...ready, ollamaConnected: false, whisperStatus: 'loading' }))
    expect(missing.map(s => s.id)).toEqual(['ollama', 'model', 'whisper'])
  })

  it('should not count models while Ollama is down', () => {
    const steps = setupSteps({ ...ready, ollamaConnected: false })
    expect(steps.find(s => s.id === 'model')?.done).toBe(false)
  })

  it('should map unknown permission values', () => {
    expect(toPermissionStatus('granted')).toBe('granted')
    expect(toPermissionStatus('something')).toBe('unknown')
    expect(toPermissionStatus(undefined)).toBe('unknown')
  })
})
