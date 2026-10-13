import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WHISPER_MODEL,
  formatModelSize,
  isEnglishOnlyModel,
  isTranscriptionLanguage,
  isWhisperModel,
  WHISPER_MODELS,
  whisperGenerateOptions,
} from '../lib/whisper'

describe('whisper options', () => {
  it('should offer tiny/base/small in multilingual and .en variants', () => {
    const ids = WHISPER_MODELS.map(m => m.id)
    for (const size of ['tiny', 'base', 'small']) {
      expect(ids).toContain(`onnx-community/whisper-${size}`)
      expect(ids).toContain(`onnx-community/whisper-${size}.en`)
    }
    expect(DEFAULT_WHISPER_MODEL).toBe('onnx-community/whisper-base')
    expect(isWhisperModel(DEFAULT_WHISPER_MODEL)).toBe(true)
  })

  it('should only accept known models and languages', () => {
    expect(isWhisperModel('someone/else')).toBe(false)
    expect(isWhisperModel(undefined)).toBe(false)
    expect(isTranscriptionLanguage('portuguese')).toBe(true)
    expect(isTranscriptionLanguage('auto')).toBe(true)
    expect(isTranscriptionLanguage('pt-BR')).toBe(false)
  })

  it('should detect English-only checkpoints', () => {
    expect(isEnglishOnlyModel('onnx-community/whisper-base.en')).toBe(true)
    expect(isEnglishOnlyModel('onnx-community/whisper-base')).toBe(false)
  })

  it('should format download sizes', () => {
    expect(formatModelSize(150)).toBe('~150 MB')
    expect(formatModelSize(970)).toBe('~970 MB')
    expect(formatModelSize(1500)).toBe('~1.5 GB')
  })
})

describe('whisperGenerateOptions', () => {
  const chunking = { chunk_length_s: 30, stride_length_s: 5 }

  it('should pass neither language nor task to an English-only model', () => {
    for (const language of ['english', 'portuguese', 'auto', undefined]) {
      const opts = whisperGenerateOptions('onnx-community/whisper-small.en', language)
      expect(opts).toEqual(chunking)
      expect(opts).not.toHaveProperty('language')
      expect(opts).not.toHaveProperty('task')
    }
  })

  it('should pass the chosen language to a multilingual model', () => {
    expect(whisperGenerateOptions('onnx-community/whisper-base', 'portuguese'))
      .toEqual({ ...chunking, language: 'portuguese', task: 'transcribe' })
    expect(whisperGenerateOptions('onnx-community/whisper-tiny', 'english'))
      .toEqual({ ...chunking, language: 'english', task: 'transcribe' })
  })

  it('should omit the language on auto so Whisper detects it', () => {
    const opts = whisperGenerateOptions('onnx-community/whisper-base', 'auto')
    expect(opts).toEqual({ ...chunking, task: 'transcribe' })
    expect(opts).not.toHaveProperty('language')
  })

  it('should treat a missing or unknown language as auto', () => {
    expect(whisperGenerateOptions('onnx-community/whisper-base', undefined)).not.toHaveProperty('language')
    expect(whisperGenerateOptions('onnx-community/whisper-base', 'klingon')).not.toHaveProperty('language')
  })
})
