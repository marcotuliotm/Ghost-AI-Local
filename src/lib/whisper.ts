// Whisper model / language options shared by the renderer (Settings UI) and the
// main process (which validates requests and builds the pipeline options).
// Pure module: no Electron or DOM imports.

export interface WhisperModelOption {
  id: string
  label: string
  // Approximate first-run download (fp32 encoder + merged decoder ONNX files)
  sizeMB: number
}

export const WHISPER_MODELS: WhisperModelOption[] = [
  { id: 'onnx-community/whisper-tiny', label: 'Tiny (multilingual)', sizeMB: 150 },
  { id: 'onnx-community/whisper-tiny.en', label: 'Tiny (English only)', sizeMB: 150 },
  { id: 'onnx-community/whisper-base', label: 'Base (multilingual)', sizeMB: 290 },
  { id: 'onnx-community/whisper-base.en', label: 'Base (English only)', sizeMB: 290 },
  { id: 'onnx-community/whisper-small', label: 'Small (multilingual)', sizeMB: 970 },
  { id: 'onnx-community/whisper-small.en', label: 'Small (English only)', sizeMB: 970 },
]

export const DEFAULT_WHISPER_MODEL = 'onnx-community/whisper-base'

// Values are the language names transformers.js accepts for `language`.
export const TRANSCRIPTION_LANGUAGES: { id: string; label: string }[] = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'english', label: 'English' },
  { id: 'portuguese', label: 'Portuguese' },
  { id: 'spanish', label: 'Spanish' },
  { id: 'french', label: 'French' },
  { id: 'german', label: 'German' },
  { id: 'italian', label: 'Italian' },
  { id: 'dutch', label: 'Dutch' },
  { id: 'russian', label: 'Russian' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'japanese', label: 'Japanese' },
  { id: 'korean', label: 'Korean' },
]

export const DEFAULT_TRANSCRIPTION_LANGUAGE = 'english'

export function isWhisperModel(id: unknown): id is string {
  return typeof id === 'string' && WHISPER_MODELS.some(m => m.id === id)
}

export function isTranscriptionLanguage(id: unknown): id is string {
  return typeof id === 'string' && TRANSCRIPTION_LANGUAGES.some(l => l.id === id)
}

// `.en` checkpoints are English-only: they have no language/task tokens.
export function isEnglishOnlyModel(modelId: string): boolean {
  return modelId.endsWith('.en')
}

export function formatModelSize(sizeMB: number): string {
  return sizeMB >= 1000 ? `~${(sizeMB / 1000).toFixed(1)} GB` : `~${sizeMB} MB`
}

export interface WhisperGenerateOptions {
  chunk_length_s: number
  stride_length_s: number
  language?: string
  task?: 'transcribe'
}

/**
 * Options for the ASR pipeline call. transformers.js throws if `language` or
 * `task` is passed to an English-only model, so those get neither. With 'auto'
 * the language is left out and Whisper detects it per segment.
 */
export function whisperGenerateOptions(modelId: string, language: string | undefined): WhisperGenerateOptions {
  const options: WhisperGenerateOptions = { chunk_length_s: 30, stride_length_s: 5 }
  if (isEnglishOnlyModel(modelId)) return options
  options.task = 'transcribe'
  if (language && language !== 'auto' && isTranscriptionLanguage(language)) {
    options.language = language
  }
  return options
}
