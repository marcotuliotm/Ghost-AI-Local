import { describe, it, expect } from 'vitest'
import {
  isCloudModel,
  isEmbeddingModel,
  isLocalOllamaUrl,
  normalizeOllamaUrl,
  parseStreamLine,
  supportsThinking,
} from '../lib/ollama'

describe('isLocalOllamaUrl', () => {
  it('should accept servers on this machine', () => {
    for (const url of [
      'http://localhost:11434',
      'http://localhost:11434/',
      'https://localhost',
      'http://LOCALHOST:11434',
      'http://ollama.localhost:11434',
      'http://127.0.0.1:11434',
      'http://127.1.2.3:8080',
      'http://[::1]:11434',
    ]) {
      expect(isLocalOllamaUrl(url), url).toBe(true)
    }
  })

  it('should reject remote, LAN and malformed addresses', () => {
    for (const url of [
      'http://192.168.0.10:11434',
      'http://10.0.0.5:11434',
      'https://ollama.com',
      'http://example.com:11434',
      'http://localhost.example.com:11434',
      'http://127.0.0.1.nip.io:11434',
      'http://0.0.0.0:11434',
      'http://128.0.0.1:11434',
      'http://127.0.0.300:11434',
      'http://user:pass@localhost:11434',
      'ftp://localhost:11434',
      'localhost:11434',
      '',
      '   ',
      undefined,
      42,
    ]) {
      expect(isLocalOllamaUrl(url), String(url)).toBe(false)
    }
  })

  it('should strip trailing slashes', () => {
    expect(normalizeOllamaUrl(' http://localhost:11434// ')).toBe('http://localhost:11434')
  })
})

describe('isCloudModel', () => {
  it('should detect cloud models by remote_host or name', () => {
    expect(isCloudModel({ name: 'qwen3.5:397b-cloud', remote_host: 'https://ollama.com:443' })).toBe(true)
    expect(isCloudModel({ name: 'custom', remote_model: 'glm-5' })).toBe(true)
    expect(isCloudModel('glm-5:cloud')).toBe(true)
    expect(isCloudModel('qwen3.5:397b-cloud')).toBe(true)
  })

  it('should keep local models', () => {
    expect(isCloudModel({ name: 'qwen3.5:latest' })).toBe(false)
    expect(isCloudModel('cloudy-llama:7b')).toBe(false)
  })
})

describe('supportsThinking', () => {
  it('should read the capabilities from /api/tags', () => {
    expect(supportsThinking({ name: 'qwen3.5', capabilities: ['completion', 'thinking'] })).toBe(true)
    expect(supportsThinking({ name: 'gemma', capabilities: ['completion'] })).toBe(false)
    expect(supportsThinking(undefined)).toBe(false)
  })
})

describe('parseStreamLine', () => {
  it('should split content and reasoning', () => {
    expect(parseStreamLine('{"message":{"role":"assistant","content":"Hi","thinking":""},"done":false}'))
      .toEqual({ content: 'Hi', thinking: '', done: false })
    expect(parseStreamLine('{"message":{"content":"","thinking":"Let me see"},"done":false}'))
      .toEqual({ content: '', thinking: 'Let me see', done: false })
    expect(parseStreamLine('{"message":{"content":""},"done":true}'))
      .toEqual({ content: '', thinking: '', done: true })
  })

  it('should surface an error sent mid-stream', () => {
    expect(parseStreamLine('{"error":"model runner has unexpectedly stopped"}')?.error)
      .toBe('model runner has unexpectedly stopped')
  })

  it('should ignore blank and malformed lines', () => {
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('{"message":')).toBeNull()
  })

describe('isEmbeddingModel', () => {
  it('should separate embedding-only models from chat models', () => {
    expect(isEmbeddingModel({ name: 'nomic-embed-text:latest', capabilities: ['embedding'] })).toBe(true)
    expect(isEmbeddingModel({ name: 'qwen3.5:latest', capabilities: ['completion', 'thinking'] })).toBe(false)
    expect(isEmbeddingModel({ name: 'old' })).toBe(false)
  })
})
})
