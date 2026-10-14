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
  shell,
} from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { DEFAULT_WHISPER_MODEL, isWhisperModel, whisperGenerateOptions } from '../src/lib/whisper'
import {
  CLOUD_MODEL_ERROR,
  isCloudModel,
  isLocalOllamaUrl,
  normalizeOllamaUrl,
  parseStreamLine,
  REMOTE_OLLAMA_ERROR,
} from '../src/lib/ollama'
import {
  DEFAULT_SHORTCUTS,
  formatAccelerator,
  isValidAccelerator,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type Shortcuts,
} from '../src/lib/shortcuts'
import { FULL_SCREENSHOT_MAX_EDGE, fitWithin, nativeCaptureSize } from '../src/lib/screenshot'
import { compactBounds } from '../src/lib/compact'

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
// since Ghost AI keeps nothing sensitive on disk (only plain-JSON settings, no
// cookies/secrets), use a mock keychain so the OS never prompts for the password.
app.commandLine.appendSwitch('use-mock-keychain')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isOverlayVisible = true

// Whisper state (main process singleton). One pipeline at a time; switching
// models disposes the current one before loading the next.
let whisperPipeline: any = null
let whisperModelId: string | null = null // model of whisperPipeline
let whisperLoading: { model: string; promise: Promise<WhisperLoadResult> } | null = null
let whisperError: string | null = null
// Transcription in progress — a model switch waits for it before disposing.
let whisperBusy: Promise<unknown> | null = null

type WhisperLoadResult = { status: 'ready' | 'error'; model: string; error?: string }

// Settings persistence: userData/settings.json. The renderer owns the schema
// (it merges what's stored with its defaults), so this just stores the object.
let settingsStore: Store | null = null
function getSettingsStore(): Store {
  if (!settingsStore) settingsStore = new Store({ name: 'settings' })
  return settingsStore
}

// Speaker-embedding state (for diarization / labeling speakers A/B/C)
let embedModel: any = null
let embedProcessor: any = null
let embedLoading = false
let embedError: string | null = null
const EMBED_MODEL = 'Xenova/wavlm-base-plus-sv'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// 16x16 PNG (black dot on transparent background) used for the tray icon.
const TRAY_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWElEQVR4nGNgoBGQBeIMIO6H4gyoGFEApOE/DtxPSPM2PJpheBs5NhN0iSwJmmEYJUwyyDAgg1znY/UGxQZQ7AWKA5FUb+BMUBQlJGJcQjApwwBFmYkkAAB0qod5uswDxAAAAABJRU5ErkJggg=='

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

  // Hidden from screen sharing / recordings by default (Settings can turn it
  // off). Set before the page loads so the overlay never shows up in a share.
  mainWindow.setContentProtection(true)

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
  // Small black dot, flagged as a template image so macOS tints it for the
  // light/dark menu bar. An empty image would leave the tray item invisible.
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG_BASE64}`)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Ghost AI')
  updateTrayMenu()

  tray.on('click', () => {
    toggleOverlay()
  })
}

// Tray menu labels show the current (user-configurable) shortcuts
function updateTrayMenu() {
  if (!tray) return
  const label = (text: string, action: ShortcutAction) =>
    `${text} (${formatAccelerator(currentShortcuts[action], process.platform === 'darwin')})`

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: label('Show/Hide', 'toggleOverlay'),
      click: () => toggleOverlay(),
    },
    {
      label: label('Screenshot', 'screenshot'),
      click: () => runShortcutAction('screenshot'),
    },
    {
      label: label('Crop Screenshot', 'cropScreenshot'),
      click: () => runShortcutAction('cropScreenshot'),
    },
    {
      label: label('Compact Mode', 'compactMode'),
      click: () => runShortcutAction('compactMode'),
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
  ]))
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

// The display the user is working on: the one under the mouse pointer
function activeDisplay(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

// Capture `display` at its physical resolution (sharp on Retina). The overlay
// itself is left out while content protection is on.
async function captureDisplay(display: Electron.Display): Promise<Electron.NativeImage | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: nativeCaptureSize(display),
    })
    const source = sources.find(s => s.display_id === String(display.id)) ?? sources[0]
    if (source && !source.thumbnail.isEmpty()) return source.thumbnail
  } catch (err) {
    console.error('Screenshot capture failed:', err)
  }
  return null
}

// Full screenshot for the model, downscaled to FULL_SCREENSHOT_MAX_EDGE
async function captureScreenshot(): Promise<string | null> {
  const image = await captureDisplay(activeDisplay())
  if (!image) return null
  const target = fitWithin(image.getSize(), FULL_SCREENSHOT_MAX_EDGE)
  const sized = target.width === image.getSize().width ? image : image.resize({ ...target, quality: 'best' })
  return sized.toDataURL()
}

// Region screenshot: the selection overlay opens on the display under the
// pointer and the crop is cut from the native-resolution capture.
async function captureScreenshotCrop(): Promise<string | null> {
  const display = activeDisplay()
  const image = await captureDisplay(display)
  if (!image) return null
  // Background preview for the selection overlay only (dimmed): JPEG keeps a
  // Retina capture to a few MB. The crop itself is cut from the native image.
  const screenshot = `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`

  // Hide main window so it doesn't appear in the crop overlay
  const wasVisible = mainWindow?.isVisible() ?? false
  const prevBounds = mainWindow?.getBounds()
  if (wasVisible) mainWindow?.hide()

  return new Promise<string | null>((resolve) => {
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

          const img = image
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

let currentShortcuts: Shortcuts = { ...DEFAULT_SHORTCUTS }
// Window bounds to restore when leaving compact mode (null = not compact)
let normalBounds: Electron.Rectangle | null = null

// System Settings panes the onboarding may open — nothing else is passed to openExternal
const PRIVACY_PANES: Record<string, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
}
let shortcutsSuspended = false

function runShortcutAction(action: ShortcutAction) {
  switch (action) {
    case 'toggleOverlay':
      toggleOverlay()
      break
    case 'screenshot':
    case 'cropScreenshot':
      void (action === 'screenshot' ? captureScreenshot() : captureScreenshotCrop()).then(shot => {
        if (shot) mainWindow?.webContents.send('screenshot-captured', shot)
      })
      break
    case 'focusInput':
      if (!isOverlayVisible) toggleOverlay()
      mainWindow?.webContents.send('focus-input')
      break
    case 'compactMode':
      // The renderer owns the view; it answers with set-compact-mode
      if (!isOverlayVisible) toggleOverlay()
      mainWindow?.webContents.send('toggle-compact')
      break
  }
}

/**
 * (Re)register the global shortcuts. Returns the actions that could not be
 * registered: invalid accelerators, or combinations another app already owns
 * (globalShortcut.register returns false).
 */
function registerShortcuts(shortcuts: Shortcuts): ShortcutAction[] {
  globalShortcut.unregisterAll()
  const failed: ShortcutAction[] = []
  for (const { id } of SHORTCUT_ACTIONS) {
    const accelerator = shortcuts[id]
    let ok = false
    try {
      ok = isValidAccelerator(accelerator) && globalShortcut.register(accelerator, () => runShortcutAction(id))
    } catch {
      ok = false
    }
    if (!ok) failed.push(id)
  }
  return failed
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

// Streaming replies in progress, by renderer requestId (for the Stop button)
const activeStreams = new Map<string, AbortController>()
// Cloud models seen in the last /api/tags (proxied to ollama.com)
let cloudModelNames = new Set<string>()

// Every Ollama request must target a local server and a local model.
function blockedOllamaRequest(baseUrl: unknown, model: unknown): string | null {
  if (!isLocalOllamaUrl(baseUrl)) return REMOTE_OLLAMA_ERROR
  if (typeof model === 'string' && (isCloudModel(model) || cloudModelNames.has(model))) return CLOUD_MODEL_ERROR
  return null
}

// Surface Ollama's actual error body (e.g. model not found, context too large,
// missing vision capability) instead of a generic status line.
async function ollamaErrorMessage(response: Response): Promise<string> {
  const detail = await response.text().catch(() => '')
  let msg = detail
  try { msg = JSON.parse(detail).error || detail } catch {}
  return `Ollama ${response.status}: ${msg || response.statusText}`
}

function sendWhisperProgress(status: string, message: string, progress: number, model?: string) {
  mainWindow?.webContents.send('whisper-progress', { status, message, progress, model })
}

// Load `model`, replacing whatever is loaded. Requests queue behind a load in
// progress; a request for the model already loading shares that load.
async function loadWhisper(model: string): Promise<WhisperLoadResult> {
  while (whisperLoading) {
    if (whisperLoading.model === model) return whisperLoading.promise
    await whisperLoading.promise.catch(() => {})
  }
  if (whisperPipeline && whisperModelId === model) return { status: 'ready', model }

  const promise = createWhisperPipeline(model)
  whisperLoading = { model, promise }
  try {
    return await promise
  } finally {
    if (whisperLoading?.promise === promise) whisperLoading = null
  }
}

async function createWhisperPipeline(model: string): Promise<WhisperLoadResult> {
  whisperError = null

  // Unload the current model first so two models are never in memory at once.
  if (whisperPipeline) {
    await whisperBusy?.catch(() => {})
    const old = whisperPipeline
    whisperPipeline = null
    whisperModelId = null
    try {
      await old.dispose?.()
    } catch (err) {
      console.warn('[whisper] Failed to dispose previous pipeline:', err)
    }
  }

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

    const shortName = model.split('/').pop()
    sendWhisperProgress('download', `Loading ${shortName}...`, 0, model)

    const pipe = await pipeline('automatic-speech-recognition', model, {
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
          sendWhisperProgress(
            'download',
            pct > 0 ? `Downloading${file}... ${pct}% ${loaded}${total}` : `Downloading${file}... ${loaded}`,
            pct,
            model,
          )
        } else if (data.status === 'initiate') {
          const file = data.file ? ` ${data.file.split('/').pop()}` : ''
          sendWhisperProgress('download', `Loading${file}...`, 10, model)
        } else if (data.status === 'done') {
          const file = data.file ? data.file.split('/').pop() : ''
          sendWhisperProgress('download', file ? `Loaded ${file}` : 'Initializing...', 90, model)
        }
        // 'ready' is sent below, once whisperModelId is set
      },
    })

    whisperPipeline = pipe
    whisperModelId = model
    sendWhisperProgress('ready', 'Whisper ready', 100, model)
    return { status: 'ready', model }
  } catch (err: any) {
    whisperError = err.message || 'Failed to load Whisper'
    sendWhisperProgress('error', whisperError!, 0, model)
    return { status: 'error', model, error: whisperError! }
  } finally {
    globalThis.fetch = originalFetch
  }
}

// IPC Handlers
function setupIPC() {
  // Ollama chat (non-streaming): background summaries, file names
  ipcMain.handle('ollama-chat', async (_event, payload: {
    model: string
    messages: Array<{ role: string; content: string; images?: string[] }>
    baseUrl: string
    options?: { num_ctx?: number }
    think?: boolean
  }) => {
    const blocked = blockedOllamaRequest(payload.baseUrl, payload.model)
    if (blocked) return { success: false, error: blocked }
    try {
      const response = await ollamaFetch(`${normalizeOllamaUrl(payload.baseUrl)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: false,
          // Thinking models otherwise reason for minutes before a one-line answer
          ...(payload.think !== undefined ? { think: payload.think } : {}),
          // num_ctx: without it Ollama silently truncates long prompts to its
          // small default window, dropping the system prompt / oldest context.
          ...(payload.options ? { options: payload.options } : {}),
        }),
      })

      if (!response.ok) throw new Error(await ollamaErrorMessage(response))

      const data = await response.json()
      return { success: true, message: data.message }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // Ollama streaming chat. Chunks go out as `ollama-stream-chunk` events tagged
  // with the renderer's requestId (so a late chunk can never land in another
  // reply); the invoke resolves with the full content once the stream ends.
  // `think: false` turns reasoning off; omitted, thinking models reason and the
  // reasoning arrives separately in `thinking`.
  ipcMain.handle('ollama-chat-stream', async (_event, payload: {
    requestId: string
    model: string
    messages: Array<{ role: string; content: string; images?: string[] }>
    baseUrl: string
    options?: { num_ctx?: number }
    think?: boolean
  }) => {
    const blocked = blockedOllamaRequest(payload.baseUrl, payload.model)
    if (blocked) return { success: false, error: blocked }

    const { requestId } = payload
    const controller = new AbortController()
    activeStreams.set(requestId, controller)
    let content = ''
    let thinking = ''

    try {
      const response = await ollamaFetch(`${normalizeOllamaUrl(payload.baseUrl)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: true,
          ...(payload.think === false ? { think: false } : {}),
          // num_ctx: without it Ollama silently truncates long prompts to its
          // small default window, dropping the system prompt / oldest context.
          ...(payload.options ? { options: payload.options } : {}),
        }),
      })

      if (!response.ok) throw new Error(await ollamaErrorMessage(response))

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader available')
      const decoder = new TextDecoder()
      // Ollama streams newline-delimited JSON. A single JSON object can be split
      // across read() chunks, so buffer partial lines instead of parsing each
      // raw chunk.
      let buffer = ''

      const handleLine = (raw: string) => {
        const line = parseStreamLine(raw)
        if (!line) return
        if (line.error) throw new Error(line.error)
        if (!line.content && !line.thinking) return
        content += line.content
        thinking += line.thinking
        mainWindow?.webContents.send('ollama-stream-chunk', {
          requestId,
          content: line.content,
          thinking: line.thinking,
        })
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
      // Flush the decoder so a multi-byte character split across the final
      // chunk isn't lost, then parse any trailing line.
      buffer += decoder.decode()
      handleLine(buffer)

      return { success: true, content, thinking }
    } catch (error: any) {
      // Stopped by the user: keep what was generated so far
      if (controller.signal.aborted) return { success: true, aborted: true, content, thinking }
      return { success: false, error: error.message, content, thinking }
    } finally {
      activeStreams.delete(requestId)
    }
  })

  // Stop a streaming reply (the Stop button)
  ipcMain.handle('ollama-abort', (_event, requestId: string) => {
    const controller = activeStreams.get(requestId)
    controller?.abort()
    return { aborted: Boolean(controller) }
  })

  // Connection + local models in one /api/tags call (polled every 10s).
  // Cloud models are left out: they would send the conversation to ollama.com.
  ipcMain.handle('ollama-status', async (_event, baseUrl: string) => {
    if (!isLocalOllamaUrl(baseUrl)) {
      return { connected: false, models: [], error: REMOTE_OLLAMA_ERROR }
    }
    try {
      const response = await ollamaFetch(`${normalizeOllamaUrl(baseUrl)}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) return { connected: false, models: [] }
      const data = await response.json()
      const all: any[] = Array.isArray(data.models) ? data.models : []
      cloudModelNames = new Set(all.filter(m => isCloudModel(m)).map(m => m.name))
      return { connected: true, models: all.filter(m => !isCloudModel(m)) }
    } catch {
      return { connected: false, models: [] }
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

  // Compact mode: shrink to a small card at the window's top-right corner, and
  // restore the previous bounds on the way out. Click-through is driven by the
  // renderer (set-ignore-mouse), which re-enables the mouse over its controls.
  ipcMain.on('set-compact-mode', (_event, enabled: boolean) => {
    if (!mainWindow) return
    if (enabled && !normalBounds) {
      normalBounds = mainWindow.getBounds()
      const { workArea } = screen.getDisplayMatching(normalBounds)
      // No traffic lights on the card: they'd cover its toolbar, and a stray
      // click on the red one would quit mid-call
      if (process.platform === 'darwin') mainWindow.setWindowButtonVisibility(false)
      mainWindow.setBounds(compactBounds(normalBounds, workArea))
    } else if (!enabled && normalBounds) {
      mainWindow.setIgnoreMouseEvents(false)
      if (process.platform === 'darwin') mainWindow.setWindowButtonVisibility(true)
      mainWindow.setBounds(normalBounds)
      normalBounds = null
    }
  })

  // Screen Recording permission (needed for system audio and screenshots).
  // macOS has no prompt API for it: it is asked on first capture, or granted
  // in System Settings.
  ipcMain.handle('get-screen-permission', () => {
    if (process.platform !== 'darwin') return { status: 'granted' }
    return { status: systemPreferences.getMediaAccessStatus('screen') }
  })

  // Open the matching System Settings privacy pane (fixed URLs only)
  ipcMain.handle('open-privacy-settings', async (_event, kind: string) => {
    const url = PRIVACY_PANES[kind]
    if (process.platform !== 'darwin' || !url) return { opened: false }
    await shell.openExternal(url)
    return { opened: true }
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

  // Hide the overlay from screen sharing / recordings (and from other apps'
  // screenshots). Settings toggle, on by default.
  ipcMain.on('set-content-protection', (_event, enabled: boolean) => {
    mainWindow?.setContentProtection(Boolean(enabled))
  })

  // Apply the shortcuts from Settings; reports the ones that failed
  ipcMain.handle('shortcuts-update', (_event, shortcuts: Partial<Shortcuts>) => {
    currentShortcuts = { ...DEFAULT_SHORTCUTS }
    for (const { id } of SHORTCUT_ACTIONS) {
      if (typeof shortcuts?.[id] === 'string') currentShortcuts[id] = shortcuts[id] as string
    }
    const failed = shortcutsSuspended ? [] : registerShortcuts(currentShortcuts)
    updateTrayMenu()
    return { failed }
  })

  // While a shortcut is being recorded in Settings, the current ones must not
  // fire (pressing the old combination would toggle the overlay).
  ipcMain.on('shortcuts-suspend', (_event, suspend: boolean) => {
    shortcutsSuspended = Boolean(suspend)
    if (shortcutsSuspended) globalShortcut.unregisterAll()
    else registerShortcuts(currentShortcuts)
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

  // Whisper - load model. A different model than the loaded one replaces it;
  // loads are serialized so two requests never build pipelines concurrently.
  ipcMain.handle('whisper-load', async (_event, model?: string) => {
    const id = isWhisperModel(model) ? model : DEFAULT_WHISPER_MODEL
    return loadWhisper(id)
  })

  // Whisper - transcribe audio in the given language ('auto' = detect)
  ipcMain.handle('whisper-transcribe', async (_event, audioBuffer: ArrayBuffer, language?: string) => {
    if (!whisperPipeline || !whisperModelId || whisperLoading) {
      return { success: false, error: 'Whisper not loaded' }
    }

    const pipe = whisperPipeline
    const run = (async () => {
      const audioData = new Float32Array(audioBuffer)
      if (audioData.length < 160) return ''
      const result = await pipe(audioData, whisperGenerateOptions(whisperModelId!, language))
      return Array.isArray(result)
        ? result.map((r: any) => r.text).join(' ').trim()
        : (result?.text || '').trim()
    })()
    whisperBusy = run

    try {
      return { success: true, text: await run }
    } catch (err: any) {
      return { success: false, error: err.message }
    } finally {
      if (whisperBusy === run) whisperBusy = null
    }
  })

  // Whisper - get status
  ipcMain.handle('whisper-status', () => {
    if (whisperLoading) return { status: 'loading', model: whisperLoading.model }
    if (whisperPipeline) return { status: 'ready', model: whisperModelId }
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

  // Settings persistence
  ipcMain.handle('settings-load', () => {
    try {
      return { settings: getSettingsStore().get('settings', null) }
    } catch (err: any) {
      console.error('Failed to read settings:', err)
      return { settings: null }
    }
  })

  ipcMain.handle('settings-save', (_event, settings: unknown) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return { success: false, error: 'Invalid settings' }
    }
    try {
      getSettingsStore().set('settings', settings)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Save conversation / transcript to .txt, or meeting notes to .md
  ipcMain.handle('save-conversation', async (_event, payload: {
    content: string
    suggestedName: string
    format?: 'txt' | 'md'
  }) => {
    try {
      const format = payload.format === 'md' ? 'md' : 'txt'
      const name = payload.suggestedName.toLowerCase().endsWith(`.${format}`)
        ? payload.suggestedName
        : `${payload.suggestedName}.${format}`
      const { canceled, filePath: savePath } = await dialog.showSaveDialog({
        title: format === 'md' ? 'Save notes' : 'Save conversation',
        defaultPath: path.join(app.getPath('documents'), name),
        filters: format === 'md'
          ? [{ name: 'Markdown', extensions: ['md'] }]
          : [{ name: 'Text', extensions: ['txt'] }],
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
  // Always answer the request: if no source is available (or the lookup fails) an
  // empty response rejects getDisplayMedia instead of leaving it pending forever.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    // The callback is one-shot. Passing the error handler as then()'s second
    // argument (not .catch) keeps a throw from callback() itself — e.g. no
    // display to capture while the screen is locked — from calling it again.
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then(
        (sources) => {
          try {
            callback(sources.length > 0 ? { video: sources[0], audio: 'loopback' } : {})
          } catch (err) {
            console.error('[display-media] Failed to grant capture:', err)
          }
        },
        () => callback({}),
      )
  })

  createWindow()

  // Tray only in production (triggers SetApplicationIsDaemon on unsigned dev builds)
  if (!VITE_DEV_SERVER_URL) {
    createTray()
  }

  registerShortcuts(currentShortcuts)
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
