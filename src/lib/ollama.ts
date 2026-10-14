// Ollama helpers shared by the renderer and the main process (which enforces
// them on every request). Pure module: no Electron or DOM imports.

export const REMOTE_OLLAMA_ERROR =
  'Only a local Ollama is allowed (localhost, 127.0.0.1 or ::1). Remote hosts are blocked so no data leaves this machine.'

export const CLOUD_MODEL_ERROR =
  'Cloud models run on ollama.com, not on this machine, so Ghost AI blocks them. Pick a local model.'

/**
 * True when `url` is an http(s) URL on this machine: localhost (and
 * *.localhost), the 127.0.0.0/8 loopback range, or ::1. Anything else —
 * LAN addresses, public hosts, other protocols, credentials in the URL — is
 * rejected, so the app can't be pointed at an Ollama on another machine.
 */
export function isLocalOllamaUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '[::1]' || host === '::1') return true
  return /^127(\.\d{1,3}){3}$/.test(host) && host.split('.').every(n => Number(n) <= 255)
}

// Base URL without a trailing slash, so `${base}/api/chat` never doubles it
export function normalizeOllamaUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export interface OllamaTagModel {
  name: string
  remote_host?: string
  remote_model?: string
  capabilities?: string[]
}

/**
 * Cloud models (e.g. "qwen3.5:397b-cloud", "glm-5:cloud") are listed by the
 * local Ollama but proxied to ollama.com. /api/tags marks them with
 * remote_host; the name suffix catches them when only the name is known.
 */
export function isCloudModel(model: OllamaTagModel | string): boolean {
  if (typeof model === 'string') return /[:-]cloud$/i.test(model)
  return Boolean(model.remote_host || model.remote_model) || /[:-]cloud$/i.test(model.name)
}

export function supportsThinking(model: OllamaTagModel | undefined): boolean {
  return Boolean(model?.capabilities?.includes('thinking'))
}

export interface StreamLine {
  content: string
  thinking: string
  done: boolean
  error?: string
}

// One line of Ollama's newline-delimited JSON stream (null if unparseable).
export function parseStreamLine(line: string): StreamLine | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const json = JSON.parse(trimmed)
    return {
      content: typeof json.message?.content === 'string' ? json.message.content : '',
      thinking: typeof json.message?.thinking === 'string' ? json.message.thinking : '',
      done: json.done === true,
      ...(typeof json.error === 'string' ? { error: json.error } : {}),
    }
  } catch {
    return null
  }
}
