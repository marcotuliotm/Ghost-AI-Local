import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  desktopCapturer,
  systemPreferences,
  session,
  net,
  dialog,
} from 'electron'
import path from 'path'
import fs from 'fs'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isOverlayVisible = true

// Whisper state (main process singleton)
let whisperPipeline: any = null
let whisperLoading = false
let whisperError: string | null = null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    x: width - 440,
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    focusable: true,
  })

  // Hide from dock on macOS (only in production for stealth)
  if (process.platform === 'darwin' && !VITE_DEV_SERVER_URL) {
    app.dock?.hide()
  }

  // Make window non-interactive in specific areas (click-through)
  mainWindow.setIgnoreMouseEvents(false)

  // Set window level to float above everything
  mainWindow.setAlwaysOnTop(true, 'floating', 1)
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('minimize', () => {
    isOverlayVisible = false
  })

  mainWindow.on('hide', () => {
    isOverlayVisible = false
  })
}

function createTray() {
  // Create a simple tray icon (16x16 transparent)
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide (Cmd+Shift+G)',
      click: () => toggleOverlay(),
    },
    {
      label: 'Screenshot (Cmd+Shift+S)',
      click: () => captureScreenshot(),
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        mainWindow?.webContents.send('open-settings')
        if (!isOverlayVisible) toggleOverlay()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setToolTip('Ghost AI')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    toggleOverlay()
  })
}

function toggleOverlay() {
  if (!mainWindow) return

  if (isOverlayVisible) {
    mainWindow.hide()
  } else {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    mainWindow.setAlwaysOnTop(true, 'floating', 1)
  }
  isOverlayVisible = !isOverlayVisible
  mainWindow?.webContents.send('overlay-visibility', isOverlayVisible)
}

async function captureScreenshot(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    })

    if (sources.length > 0) {
      return sources[0].thumbnail.toDataURL()
    }
  } catch (err) {
    console.error('Screenshot capture failed:', err)
  }
  return null
}

function registerShortcuts() {
  // Toggle overlay visibility
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    toggleOverlay()
  })

  // Capture screenshot
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    const screenshot = await captureScreenshot()
    if (screenshot) {
      mainWindow?.webContents.send('screenshot-captured', screenshot)
    }
  })

  // Quick ask (focus input)
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!isOverlayVisible) toggleOverlay()
    mainWindow?.webContents.send('focus-input')
  })
}

// IPC Handlers
function setupIPC() {
  // Ollama chat
  ipcMain.handle('ollama-chat', async (_event, payload: {
    model: string
    messages: Array<{ role: string; content: string }>
    baseUrl: string
  }) => {
    try {
      const response = await fetch(`${payload.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: false,
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      return { success: true, message: data.message }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // Ollama streaming chat
  ipcMain.handle('ollama-chat-stream', async (event, payload: {
    model: string
    messages: Array<{ role: string; content: string }>
    baseUrl: string
  }) => {
    try {
      const response = await fetch(`${payload.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: true,
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader available')

      let fullResponse = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(Boolean)

        for (const line of lines) {
          try {
            const json = JSON.parse(line)
            if (json.message?.content) {
              fullResponse += json.message.content
              mainWindow?.webContents.send('ollama-stream-chunk', json.message.content)
            }
            if (json.done) {
              mainWindow?.webContents.send('ollama-stream-done', fullResponse)
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      return { success: true, message: { role: 'assistant', content: fullResponse } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // List Ollama models
  ipcMain.handle('ollama-list-models', async (_event, baseUrl: string) => {
    try {
      const response = await fetch(`${baseUrl}/api/tags`)
      if (!response.ok) throw new Error('Failed to fetch models')
      const data = await response.json()
      return { success: true, models: data.models || [] }
    } catch (error: any) {
      return { success: false, error: error.message, models: [] }
    }
  })

  // Check Ollama connection
  ipcMain.handle('ollama-check', async (_event, baseUrl: string) => {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
      return { connected: response.ok }
    } catch {
      return { connected: false }
    }
  })

  // Screenshot capture
  ipcMain.handle('capture-screenshot', async () => {
    return await captureScreenshot()
  })

  // Window controls
  ipcMain.on('window-minimize', () => {
    mainWindow?.hide()
    isOverlayVisible = false
  })

  ipcMain.on('window-close', () => {
    app.quit()
  })

  ipcMain.on('set-ignore-mouse', (_event, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // Move window
  ipcMain.on('window-move', (_event, { x, y }: { x: number; y: number }) => {
    mainWindow?.setPosition(x, y)
  })

  // Resize window
  ipcMain.on('window-resize', (_event, { width, height }: { width: number; height: number }) => {
    mainWindow?.setSize(width, height)
  })

  // Opacity control
  ipcMain.on('set-opacity', (_event, opacity: number) => {
    mainWindow?.setOpacity(opacity)
  })

  // Microphone permission
  ipcMain.handle('request-mic-permission', async () => {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      if (status === 'granted') return { granted: true }
      const granted = await systemPreferences.askForMediaAccess('microphone')
      return { granted }
    }
    // Windows/Linux: permission handled by OS prompt via getUserMedia
    return { granted: true }
  })

  ipcMain.handle('get-mic-status', () => {
    if (process.platform === 'darwin') {
      return { status: systemPreferences.getMediaAccessStatus('microphone') }
    }
    return { status: 'granted' }
  })

  // Whisper - load model
  ipcMain.handle('whisper-load', async () => {
    if (whisperPipeline) return { status: 'ready' }
    if (whisperLoading) return { status: 'loading' }

    whisperLoading = true
    whisperError = null

    // Use Electron's net.fetch (Chromium network stack) instead of Node's undici fetch.
    // Node's fetch fails on HuggingFace's 302 redirect chain in Electron's main process.
    const originalFetch = globalThis.fetch
    globalThis.fetch = net.fetch as typeof globalThis.fetch

    try {
      // Dynamic import - @huggingface/transformers is ESM, main process is CJS
      const { pipeline, env } = await import('@huggingface/transformers')

      // Download models from HuggingFace (cached after first download)
      env.allowLocalModels = false

      mainWindow?.webContents.send('whisper-progress', {
        status: 'download',
        message: 'Downloading Whisper model...',
        progress: 0,
      })

      whisperPipeline = await pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-tiny',
        {
          progress_callback: (data: any) => {
            if (data.status === 'progress') {
              // data.progress is already 0-100 when available
              // data.loaded / data.total when content-length is known
              // When content-length is missing, progress may be undefined
              let pct = 0
              if (typeof data.progress === 'number') {
                pct = Math.round(data.progress)
              } else if (data.total) {
                pct = Math.round((data.loaded / data.total) * 100)
              }

              const loaded = data.loaded
                ? `${(data.loaded / 1024 / 1024).toFixed(1)}MB`
                : ''
              const total = data.total
                ? ` / ${(data.total / 1024 / 1024).toFixed(1)}MB`
                : ''
              const file = data.file ? ` (${data.file.split('/').pop()})` : ''

              mainWindow?.webContents.send('whisper-progress', {
                status: 'download',
                message: pct > 0
                  ? `Downloading${file}... ${pct}% ${loaded}${total}`
                  : `Downloading${file}... ${loaded}`,
                progress: pct,
              })
            } else if (data.status === 'initiate') {
              const file = data.file ? ` ${data.file.split('/').pop()}` : ''
              mainWindow?.webContents.send('whisper-progress', {
                status: 'download',
                message: `Starting download${file}...`,
                progress: 0,
              })
            } else if (data.status === 'done') {
              mainWindow?.webContents.send('whisper-progress', {
                status: 'download',
                message: 'Loading model into memory...',
                progress: 90,
              })
            } else if (data.status === 'ready') {
              mainWindow?.webContents.send('whisper-progress', {
                status: 'ready',
                message: 'Whisper ready',
                progress: 100,
              })
            }
          },
        },
      )

      whisperLoading = false
      // Restore original fetch after model is loaded
      globalThis.fetch = originalFetch
      mainWindow?.webContents.send('whisper-progress', {
        status: 'ready',
        message: 'Whisper ready',
        progress: 100,
      })
      return { status: 'ready' }
    } catch (err: any) {
      whisperLoading = false
      globalThis.fetch = originalFetch
      whisperError = err.message || 'Failed to load Whisper'
      mainWindow?.webContents.send('whisper-progress', {
        status: 'error',
        message: whisperError,
        progress: 0,
      })
      return { status: 'error', error: whisperError }
    }
  })

  // Whisper - transcribe audio
  ipcMain.handle('whisper-transcribe', async (_event, audioBuffer: ArrayBuffer) => {
    if (!whisperPipeline) {
      return { success: false, error: 'Whisper not loaded' }
    }

    try {
      const audioData = new Float32Array(audioBuffer)
      if (audioData.length < 160) {
        return { success: true, text: '' }
      }

      const result = await whisperPipeline(audioData, {
        language: 'english',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      })

      const text = Array.isArray(result)
        ? result.map((r: any) => r.text).join(' ').trim()
        : (result?.text || '').trim()

      return { success: true, text }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Whisper - get status
  ipcMain.handle('whisper-status', () => {
    if (whisperPipeline) return { status: 'ready' }
    if (whisperLoading) return { status: 'loading' }
    if (whisperError) return { status: 'error', error: whisperError }
    return { status: 'idle' }
  })

  // Save conversation to .txt file
  ipcMain.handle('save-conversation', async (_event, payload: {
    content: string
    suggestedName: string
  }) => {
    try {
      const { canceled, filePath: savePath } = await dialog.showSaveDialog({
        title: 'Salvar conversa',
        defaultPath: path.join(app.getPath('documents'), payload.suggestedName),
        filters: [{ name: 'Text', extensions: ['txt'] }],
      })

      if (canceled || !savePath) return { success: false, canceled: true }

      fs.writeFileSync(savePath, payload.content, 'utf-8')
      return { success: true, path: savePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}

// App lifecycle
app.whenReady().then(() => {
  // Auto-grant microphone permission for the renderer
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'screen'].includes(permission)
    callback(allowed)
  })

  // Handle getDisplayMedia requests - capture system audio via loopback (macOS 13+ ScreenCaptureKit)
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      }
    })
  })

  createWindow()

  // Tray only in production (triggers SetApplicationIsDaemon on unsigned dev builds)
  if (!VITE_DEV_SERVER_URL) {
    createTray()
  }

  registerShortcuts()
  setupIPC()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// Prevent multiple instances (production only - triggers SetApplicationIsDaemon in dev)
if (!VITE_DEV_SERVER_URL) {
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (!isOverlayVisible) toggleOverlay()
        mainWindow.focus()
      }
    })
  }
}
