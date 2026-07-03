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
  clipboard,
} from 'electron'
import path from 'path'
import fs from 'fs'

// Fix macOS system-audio loopback on Electron 39+ (Chromium 142+).
// Chromium 142 enabled Apple's new CoreAudio Tap API (MacCatapLoopbackAudioForScreenShare)
// by default. That path requires a brand-new `NSAudioCaptureUsageDescription` permission
// that can't be queried, so it fails silently — the loopback track comes up "live but
// silent" (no level, no audio) and there is no fallback to the old API.
// Disabling this feature makes Chromium fall back to the ScreenCaptureKit path, which uses
// the Screen Recording permission the app already requests. MUST be set before app is ready.
// Ref: https://github.com/electron/electron/issues/49607
app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')

// Avoid the macOS "ghost-ai Safe Storage" keychain prompt. Chromium stores an
// encryption key in the login keychain to encrypt its local network/cookie data;
// since Ghost AI keeps nothing sensitive on disk (settings are in-memory, no
// cookies/secrets), use a mock keychain so the OS never prompts for the password.
app.commandLine.appendSwitch('use-mock-keychain')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isOverlayVisible = true

// Whisper state (main process singleton)
let whisperPipeline: any = null
let whisperLoading = false
let whisperError: string | null = null

// Speaker-embedding state (for diarization / labeling speakers A/B/C)
let embedModel: any = null
let embedProcessor: any = null
let embedLoading = false
let embedError: string | null = null
const EMBED_MODEL = 'Xenova/wavlm-base-plus-sv'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    x: width - 440,
    y: 60,
    // macOS-native chrome: hidden title bar exposes the real traffic-light
    // buttons (red/yellow/green) in the top-left corner.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 14 },
    alwaysOnTop: true,
    resizable: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#00000000',
    // Native macOS vibrancy: real frosted-glass material that blurs the desktop
    // behind the window and automatically adapts to the system light/dark mode.
    vibrancy: 'under-window',
    visualEffectState: 'active',
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

  // Native red traffic-light button closes the window → quit the app
  // (keeps the existing "close = quit" semantics for this single-window overlay).
  mainWindow.on('close', () => {
    app.quit()
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
    {
      label: 'Crop Screenshot (Cmd+Shift+X)',
      click: () => captureScreenshotCrop(),
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

async function captureScreenshotCrop(): Promise<string | null> {
  const screenshot = await captureScreenshot()
  if (!screenshot) return null

  // Hide main window so it doesn't appear in the crop overlay
  const wasVisible = mainWindow?.isVisible() ?? false
  const prevBounds = mainWindow?.getBounds()
  if (wasVisible) mainWindow?.hide()

  return new Promise<string | null>((resolve) => {
    const display = screen.getPrimaryDisplay()
    const { x, y, width, height } = display.bounds

    const cropWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      fullscreen: false,
      fullscreenable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    cropWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    // Cover the entire screen including menu bar without native fullscreen
    cropWindow.setSimpleFullScreen(true)

    let resolved = false
    const finish = (result: string | null) => {
      if (resolved) return
      resolved = true
      if (!cropWindow.isDestroyed()) {
        cropWindow.setSimpleFullScreen(false)
        cropWindow.close()
      }
      if (wasVisible && mainWindow) {
        if (prevBounds) {
          mainWindow.setBounds(prevBounds)
        }
        mainWindow.show()
        mainWindow.setAlwaysOnTop(true, 'floating', 1)
      }
      resolve(result)
    }

    cropWindow.on('closed', () => finish(null))

    const cropHTML = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{cursor:crosshair;overflow:hidden;background:#000;user-select:none;-webkit-user-select:none}
#bg{position:fixed;top:0;left:0;width:100vw;height:100vh;object-fit:cover;filter:brightness(0.4)}
#canvas{position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:10}
#hint{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:20;color:#fff;font-family:-apple-system,sans-serif;font-size:14px;padding:8px 16px;background:rgba(0,0,0,0.7);border-radius:8px;pointer-events:none}
</style></head><body>
<img id="bg" />
<canvas id="canvas"></canvas>
<div id="hint">Click and drag to select region — Esc to cancel</div>
<script>
const bg=document.getElementById('bg'),canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
canvas.width=window.innerWidth;canvas.height=window.innerHeight;
let sx=0,sy=0,drawing=false,rect=null;
const img=new Image();

window.__cropResult=new Promise(ok=>{
  bg.onload=()=>{img.src=bg.src};
  canvas.addEventListener('mousedown',e=>{sx=e.clientX;sy=e.clientY;drawing=true;rect=null});
  canvas.addEventListener('mousemove',e=>{
    if(!drawing)return;
    const x=Math.min(sx,e.clientX),y=Math.min(sy,e.clientY);
    rect={x,y,w:Math.abs(e.clientX-sx),h:Math.abs(e.clientY-sy)};
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(img.naturalWidth){
      const rx=img.naturalWidth/canvas.width,ry=img.naturalHeight/canvas.height;
      ctx.drawImage(img,rect.x*rx,rect.y*ry,rect.w*rx,rect.h*ry,rect.x,rect.y,rect.w,rect.h);
    }
    ctx.strokeStyle='#00ff88';ctx.lineWidth=2;ctx.setLineDash([5,3]);
    ctx.strokeRect(rect.x,rect.y,rect.w,rect.h);
    ctx.setLineDash([]);ctx.fillStyle='rgba(0,0,0,0.7)';ctx.font='12px -apple-system,sans-serif';
    const lb=Math.round(rect.w)+'x'+Math.round(rect.h),lw=ctx.measureText(lb).width+8;
    ctx.fillRect(rect.x+rect.w-lw-4,rect.y+rect.h+4,lw+4,20);
    ctx.fillStyle='#00ff88';ctx.fillText(lb,rect.x+rect.w-lw,rect.y+rect.h+18);
  });
  canvas.addEventListener('mouseup',()=>{drawing=false;if(rect&&rect.w>5&&rect.h>5)ok(rect);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')ok(null)});
});
</script></body></html>`

    cropWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(cropHTML)}`)

    cropWindow.webContents.on('did-finish-load', () => {
      // Inject the screenshot src after load (avoids URL length issues with data: URL)
      cropWindow.webContents.executeJavaScript(
        `document.getElementById('bg').src = ${JSON.stringify(screenshot)};`
      ).catch(() => {})

      // Wait for crop result
      cropWindow.webContents.executeJavaScript('window.__cropResult')
        .then((rect: { x: number; y: number; w: number; h: number } | null) => {
          if (!rect || rect.w < 5 || rect.h < 5) {
            finish(null)
            return
          }

          const img = nativeImage.createFromDataURL(screenshot)
          const imgSize = img.getSize()
          const scaleX = imgSize.width / width
          const scaleY = imgSize.height / height

          const cropped = img.crop({
            x: Math.round(rect.x * scaleX),
            y: Math.round(rect.y * scaleY),
            width: Math.round(rect.w * scaleX),
            height: Math.round(rect.h * scaleY),
          })

          finish(cropped.toDataURL())
        })
        .catch(() => finish(null))
    })
  })
}

function registerShortcuts() {
  // Toggle overlay visibility
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    toggleOverlay()
  })

  // Capture full screenshot
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    const screenshot = await captureScreenshot()
    if (screenshot) {
      mainWindow?.webContents.send('screenshot-captured', screenshot)
    }
  })

  // Capture cropped screenshot
  globalShortcut.register('CommandOrControl+Shift+X', async () => {
    const screenshot = await captureScreenshotCrop()
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

// All Ollama traffic goes through Chromium's net.fetch instead of Node's
// undici fetch. Undici pools keep-alive connections and, when Ollama closes an
// idle socket, a subsequent POST is written to that dead connection; the server
// reads a truncated body and replies "400: unexpected EOF". Undici will not
// transparently retry a POST (only idempotent GET/HEAD), so the error reaches
// the user — typically after several summarize/suggest-reply calls with idle
// gaps between them. Chromium's net stack retries requests that fail on a
// reused connection before any response bytes arrive, which eliminates this.
const ollamaFetch: typeof globalThis.fetch = (input: any, init?: any) =>
  (net.fetch as any)(input, init)

// IPC Handlers
function setupIPC() {
  // Ollama chat
  ipcMain.handle('ollama-chat', async (_event, payload: {
    model: string
    messages: Array<{ role: string; content: string; images?: string[] }>
    baseUrl: string
  }) => {
    try {
      const response = await ollamaFetch(`${payload.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: false,
        }),
      })

      if (!response.ok) {
        // Surface Ollama's actual error body (e.g. model not found, context too
        // large, missing vision capability) instead of a generic status line.
        const detail = await response.text().catch(() => '')
        let msg = detail
        try { msg = JSON.parse(detail).error || detail } catch {}
        throw new Error(`Ollama ${response.status}: ${msg || response.statusText}`)
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
    messages: Array<{ role: string; content: string; images?: string[] }>
    baseUrl: string
  }) => {
    try {
      const response = await ollamaFetch(`${payload.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: true,
        }),
      })

      if (!response.ok) {
        // Surface Ollama's actual error body (e.g. model not found, context too
        // large, missing vision capability) instead of a generic status line.
        const detail = await response.text().catch(() => '')
        let msg = detail
        try { msg = JSON.parse(detail).error || detail } catch {}
        throw new Error(`Ollama ${response.status}: ${msg || response.statusText}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader available')

      let fullResponse = ''
      let doneSent = false
      // Ollama streams newline-delimited JSON. A single JSON object can be split
      // across read() chunks, so buffer partial lines instead of parsing each
      // raw chunk — otherwise the split line (and its `done` flag) is dropped,
      // leaving the UI stuck in the streaming state.
      let buffer = ''

      const handleLine = (line: string) => {
        if (!line) return
        try {
          const json = JSON.parse(line)
          if (json.message?.content) {
            fullResponse += json.message.content
            mainWindow?.webContents.send('ollama-stream-chunk', json.message.content)
          }
          if (json.done) {
            doneSent = true
            mainWindow?.webContents.send('ollama-stream-done', fullResponse)
          }
        } catch {
          // Skip malformed lines
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last, possibly-incomplete line in the buffer.
        buffer = lines.pop() ?? ''
        for (const line of lines) handleLine(line)
      }

      // Flush the decoder's internal state so a multi-byte character split
      // across the final chunk isn't lost, then parse any trailing line.
      buffer += decoder.decode()
      handleLine(buffer.trim())

      // If the stream ended without ever delivering a `done` line (connection
      // severed mid-stream, or a truncated/malformed final fragment), the
      // renderer would stay stuck in the streaming state. Emit the done event
      // as a fallback so isStreaming is always reset.
      if (!doneSent) {
        mainWindow?.webContents.send('ollama-stream-done', fullResponse)
      }

      return { success: true, message: { role: 'assistant', content: fullResponse } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // List Ollama models
  ipcMain.handle('ollama-list-models', async (_event, baseUrl: string) => {
    try {
      const response = await ollamaFetch(`${baseUrl}/api/tags`)
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
      const response = await ollamaFetch(`${baseUrl}/api/tags`, {
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

  // Screenshot crop — opens a fullscreen overlay for region selection
  ipcMain.handle('capture-screenshot-crop', async () => {
    return await captureScreenshotCrop()
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

    // Use Chromium's net.fetch for HuggingFace downloads.
    // Node's undici fetch can fail on HuggingFace's 302 redirect chain.
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      try {
        return await (net.fetch as any)(input, init)
      } catch {
        return originalFetch(input, init)
      }
    }) as typeof globalThis.fetch

    try {
      const { pipeline, env } = await import('@huggingface/transformers')

      // CRITICAL: default cacheDir resolves to inside the asar archive in
      // production. Native onnxruntime-node addon can't read .onnx files from
      // asar, causing a silent hang. Redirect cache to a real writable directory.
      const cacheDir = path.join(app.getPath('userData'), 'whisper-models')
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
      env.cacheDir = cacheDir

      // Don't look for models inside node_modules (also inside asar in prod)
      env.allowLocalModels = false

      mainWindow?.webContents.send('whisper-progress', {
        status: 'download',
        message: 'Loading Whisper model...',
        progress: 0,
      })

      whisperPipeline = await pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-tiny',
        {
          progress_callback: (data: any) => {
            if (data.status === 'progress') {
              let pct = 0
              if (typeof data.progress === 'number') {
                pct = Math.round(data.progress)
              } else if (data.total) {
                pct = Math.round((data.loaded / data.total) * 100)
              }
              const loaded = data.loaded ? `${(data.loaded / 1024 / 1024).toFixed(1)}MB` : ''
              const total = data.total ? ` / ${(data.total / 1024 / 1024).toFixed(1)}MB` : ''
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
                message: `Loading${file}...`,
                progress: 10,
              })
            } else if (data.status === 'done') {
              const file = data.file ? data.file.split('/').pop() : ''
              mainWindow?.webContents.send('whisper-progress', {
                status: 'download',
                message: file ? `Loaded ${file}` : 'Initializing...',
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

  // Speaker embedding - load model (lazy, like Whisper). Used for diarization:
  // each audio chunk gets a voice "fingerprint" that the renderer clusters into
  // Speaker A/B/C. 100% local; model is cached under userData/whisper-models.
  ipcMain.handle('embed-load', async () => {
    if (embedModel) return { status: 'ready' }
    if (embedLoading) return { status: 'loading' }

    embedLoading = true
    embedError = null

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      try {
        return await (net.fetch as any)(input, init)
      } catch {
        return originalFetch(input, init)
      }
    }) as typeof globalThis.fetch

    try {
      const { AutoProcessor, AutoModel, env } = await import('@huggingface/transformers')

      const cacheDir = path.join(app.getPath('userData'), 'whisper-models')
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
      env.cacheDir = cacheDir
      env.allowLocalModels = false

      mainWindow?.webContents.send('embed-progress', {
        status: 'download',
        message: 'Loading speaker model...',
        progress: 0,
      })

      embedProcessor = await AutoProcessor.from_pretrained(EMBED_MODEL)
      embedModel = await AutoModel.from_pretrained(EMBED_MODEL, {
        progress_callback: (data: any) => {
          if (data.status === 'progress' && typeof data.progress === 'number') {
            mainWindow?.webContents.send('embed-progress', {
              status: 'download',
              message: `Downloading speaker model... ${Math.round(data.progress)}%`,
              progress: Math.round(data.progress),
            })
          }
        },
      })

      embedLoading = false
      globalThis.fetch = originalFetch
      mainWindow?.webContents.send('embed-progress', {
        status: 'ready',
        message: 'Speaker model ready',
        progress: 100,
      })
      return { status: 'ready' }
    } catch (err: any) {
      embedLoading = false
      globalThis.fetch = originalFetch
      embedError = err.message || 'Failed to load speaker model'
      mainWindow?.webContents.send('embed-progress', {
        status: 'error',
        message: embedError,
        progress: 0,
      })
      return { status: 'error', error: embedError }
    }
  })

  // Speaker embedding - return a normalized embedding vector for a chunk of
  // 16kHz audio (Float32Array over IPC). The renderer clusters these by cosine
  // similarity to assign Speaker A/B/C labels.
  ipcMain.handle('embed-speaker', async (_event, audioBuffer: ArrayBuffer) => {
    if (!embedModel || !embedProcessor) {
      return { success: false, error: 'Speaker model not loaded' }
    }

    try {
      const audioData = new Float32Array(audioBuffer)
      // Need ~1s+ of audio for a stable speaker embedding
      if (audioData.length < 16000) {
        return { success: false, error: 'audio too short' }
      }

      const inputs = await embedProcessor(audioData)
      const output = await embedModel(inputs)
      const tensor = output.embeddings ?? output.logits
      if (!tensor?.data) {
        return { success: false, error: 'no embedding produced' }
      }

      const vec = Array.from(tensor.data as Float32Array)
      // L2-normalize so the renderer can use plain dot product as cosine similarity
      let norm = 0
      for (const v of vec) norm += v * v
      norm = Math.sqrt(norm) || 1
      const embedding = vec.map((v) => v / norm)

      return { success: true, embedding }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Speaker embedding - get status
  ipcMain.handle('embed-status', () => {
    if (embedModel) return { status: 'ready' }
    if (embedLoading) return { status: 'loading' }
    if (embedError) return { status: 'error', error: embedError }
    return { status: 'idle' }
  })

  // Copy text to the system clipboard (native, bypasses web clipboard permissions)
  ipcMain.handle('clipboard-write', (_event, text: string) => {
    clipboard.writeText(text ?? '')
    return true
  })

  // Save conversation to .txt file
  ipcMain.handle('save-conversation', async (_event, payload: {
    content: string
    suggestedName: string
  }) => {
    try {
      const { canceled, filePath: savePath } = await dialog.showSaveDialog({
        title: 'Save conversation',
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
  // NOTE: On Electron 39+ this only works because the CoreAudio Tap feature is disabled at
  // startup (see `disable-features` at the top of this file), forcing the ScreenCaptureKit path.
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
