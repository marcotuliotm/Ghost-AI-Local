// Content-Security-Policy for the renderer (injected into index.html by the
// Vite plugin in vite.config.mts). The renderer never talks to the network:
// Ollama and Whisper are reached through the main process over IPC. So the
// production policy allows no connections at all, only the app's own files,
// data:/blob: images (screenshots) and the blob: AudioWorklet module.
// Pure module, no imports.

const COMMON: Record<string, string[]> = {
  'default-src': ["'none'"],
  'style-src': ["'self'", "'unsafe-inline'"], // Vite/Tailwind <style>, React style props
  'img-src': ["'self'", 'data:', 'blob:'], // screenshots are data: URLs
  'font-src': ["'self'", 'data:'],
  'media-src': ["'self'", 'blob:', 'mediastream:'],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
}

export function contentSecurityPolicy(dev: boolean): string {
  const directives: Record<string, string[]> = {
    ...COMMON,
    // blob: = the capture AudioWorklet (AudioCapture.tsx)
    'script-src': dev
      ? ["'self'", "'unsafe-inline'", 'blob:'] // Vite's inline React-refresh preamble
      : ["'self'", 'blob:'],
    'connect-src': dev
      ? ["'self'", 'ws://localhost:*', 'http://localhost:*'] // Vite dev server + HMR socket
      : ["'none'"],
  }
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
}
