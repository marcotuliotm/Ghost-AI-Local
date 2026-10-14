// First-run setup: what is ready and what still needs the user. Pure module.

export type PermissionStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface SetupState {
  ollamaConnected: boolean
  modelCount: number
  micStatus: PermissionStatus
  screenStatus: PermissionStatus
  whisperStatus: 'idle' | 'loading' | 'ready' | 'error'
}

export type StepId = 'ollama' | 'model' | 'microphone' | 'screen' | 'whisper'

export interface SetupStep {
  id: StepId
  title: string
  done: boolean
  // Optional steps don't block "Finish": the app works without them (e.g.
  // the mic isn't needed to transcribe a call's system audio).
  optional: boolean
}

// A model the user can pull when none is installed (shown as a command to copy;
// Ghost AI never downloads models from ollama.com itself).
export const SUGGESTED_OLLAMA_MODEL = 'gemma3:4b'

export function setupSteps(state: SetupState): SetupStep[] {
  return [
    { id: 'ollama', title: 'Ollama is running', done: state.ollamaConnected, optional: false },
    { id: 'model', title: 'A local model is installed', done: state.ollamaConnected && state.modelCount > 0, optional: false },
    { id: 'microphone', title: 'Microphone access', done: state.micStatus === 'granted', optional: true },
    { id: 'screen', title: 'Screen Recording access (system audio, screenshots)', done: state.screenStatus === 'granted', optional: true },
    { id: 'whisper', title: 'Speech-to-text model downloaded', done: state.whisperStatus === 'ready', optional: false },
  ]
}

// Required steps that are still missing (empty = the app is usable)
export function missingRequired(steps: SetupStep[]): SetupStep[] {
  return steps.filter(s => !s.optional && !s.done)
}

export function toPermissionStatus(value: unknown): PermissionStatus {
  return value === 'granted' || value === 'denied' || value === 'restricted' || value === 'not-determined'
    ? value
    : 'unknown'
}
