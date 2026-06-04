# AGENTS.md - Ghost AI Project Guide

## Project Overview

Ghost AI is a **100% local, anonymous AI assistant** built as a macOS overlay app. It provides real-time suggestions during conversations, meetings, and interviews. Zero cloud, zero telemetry — all inference runs locally via Ollama and Whisper.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 42.3.2 (see audio-loopback note below) |
| Frontend | React 18 + TypeScript 5 |
| Bundler | Vite 6 + vite-plugin-electron |
| Styling | TailwindCSS 3 |
| LLM | Ollama (default model: `gemma4:latest`) |
| Speech-to-Text | `@huggingface/transformers` v4 with `onnx-community/whisper-tiny` |
| Speaker ID (diarization) | `@huggingface/transformers` v4 with `Xenova/wavlm-base-plus-sv` |
| Package manager | npm |
| Build/Dist | electron-builder (DMG + ZIP for macOS, NSIS for Windows) |

## Project Structure

```
Ghost-AI-Local/
├── electron/
│   ├── main.ts          # Main process: window, tray, shortcuts, IPC, Whisper
│   └── preload.ts       # contextBridge exposing ghostAPI to renderer
├── src/
│   ├── App.tsx           # Root component, view routing (overlay | settings | help)
│   ├── main.tsx          # React entry point
│   ├── types.ts          # All TypeScript interfaces (GhostAPI, Settings, ChatMessage, etc.)
│   ├── components/
│   │   ├── Overlay.tsx       # Main UI: chat, quick actions, audio, save, welcome screen
│   │   ├── AudioCapture.tsx  # Audio capture: source toggle, per-channel PCM, Whisper transcription, speaker diarization (You/A/B/C), Auto mode, auto-restart on stream death
│   │   ├── ChatInput.tsx     # Text input with send
│   │   ├── MessageBubble.tsx # Chat message display with per-message copy button
│   │   ├── Settings.tsx      # Settings panel (model, system prompt, suggest-reply prompt, opacity, font size, interval)
│   │   └── HelpPanel.tsx     # Help reference (shortcuts, buttons, descriptions)
│   ├── hooks/
│   │   ├── useGhostAI.ts     # Core hook: Ollama streaming, settings, connection check
│   │   └── useWhisper.ts     # Whisper hook: IPC bridge, progress tracking
│   └── styles/
│       └── globals.css       # TailwindCSS + custom glass/animation styles
├── vite.config.mts           # Vite config with electron plugin, externals
├── tsconfig.json             # Renderer TypeScript config
├── tsconfig.node.json        # Electron/Node TypeScript config
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── index.html
```

## Commands

```bash
npm run dev        # Start dev server (Vite + Electron)
npm run build      # TypeScript check + Vite build (renderer + main + preload)
npm run dist:mac   # Build + package macOS DMG/ZIP
npm run dist:win   # Build + package Windows NSIS
```

**Build verification**: Always run `npm run build` after changes. It runs `tsc && vite build && tsc -p tsconfig.node.json` and catches both TypeScript and bundler errors.

## Architecture

### Process Model (Electron)

```
┌─────────────────────┐         IPC          ┌──────────────────────┐
│   Renderer Process  │◄────────────────────►│    Main Process      │
│   (React + Vite)    │                      │    (electron/main.ts)│
│                     │  contextBridge       │                      │
│  src/App.tsx        │  via preload.ts      │  - Window management │
│  src/components/*   │◄────────────────────►│  - Ollama HTTP calls │
│  src/hooks/*        │  window.ghostAPI     │  - Whisper inference │
│                     │                      │  - Global shortcuts  │
│                     │                      │  - Tray (prod only)  │
│                     │                      │  - Screenshot capture│
│                     │                      │  - File save dialogs │
└─────────────────────┘                      └──────────────────────┘
```

### Data Flow

1. **Chat**: User input -> `useGhostAI.sendMessage()` -> IPC `ollama-chat-stream` -> main process `fetch()` to Ollama -> stream chunks back via `webContents.send('ollama-stream-chunk')` -> renderer updates message in real time
2. **Audio**: Mic/System audio -> Web Audio API (per-channel PCM capture) -> resample to 16kHz -> IPC `whisper-transcribe` -> main process runs Whisper pipeline -> text returned. With "Speakers" on, system-audio chunks also go through IPC `embed-speaker` -> main process speaker-embedding model -> embedding clustered in the renderer into A/B/C. Result is displayed as labeled segments in the AudioCapture transcript area
3. **Screenshot**: Global shortcut or button -> `desktopCapturer.getSources()` -> base64 dataURL -> sent to Ollama as context with analysis prompt

### IPC Channel Map

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `ollama-chat` | renderer->main | invoke | Non-streaming Ollama chat |
| `ollama-chat-stream` | renderer->main | invoke | Streaming Ollama chat |
| `ollama-list-models` | renderer->main | invoke | List available models |
| `ollama-check` | renderer->main | invoke | Health check (3s timeout) |
| `capture-screenshot` | renderer->main | invoke | desktopCapturer screenshot |
| `whisper-load` | renderer->main | invoke | Load Whisper model |
| `whisper-transcribe` | renderer->main | invoke | Transcribe Float32Array audio |
| `whisper-status` | renderer->main | invoke | Get current Whisper status |
| `embed-load` | renderer->main | invoke | Load speaker-embedding model (diarization) |
| `embed-speaker` | renderer->main | invoke | Return normalized speaker embedding for Float32Array audio |
| `embed-status` | renderer->main | invoke | Get speaker-embedding model status |
| `embed-progress` | main->renderer | send | Speaker model download progress |
| `save-conversation` | renderer->main | invoke | Show save dialog + write .txt |
| `clipboard-write` | renderer->main | invoke | Write text to native clipboard (bypasses web permission handler) |
| `request-mic-permission` | renderer->main | invoke | macOS microphone access |
| `get-mic-status` | renderer->main | invoke | Check mic permission status |
| `window-minimize` | renderer->main | send | Hide window |
| `window-close` | renderer->main | send | Quit app |
| `window-move` | renderer->main | send | Reposition window |
| `window-resize` | renderer->main | send | Resize window |
| `set-opacity` | renderer->main | send | Set window opacity |
| `set-ignore-mouse` | renderer->main | send | Click-through toggle |
| `ollama-stream-chunk` | main->renderer | send | Streaming text chunk |
| `ollama-stream-done` | main->renderer | send | Stream complete |
| `screenshot-captured` | main->renderer | send | Screenshot from shortcut |
| `focus-input` | main->renderer | send | Focus chat input |
| `open-settings` | main->renderer | send | Open settings view |
| `overlay-visibility` | main->renderer | send | Visibility state changed |
| `whisper-progress` | main->renderer | send | Model download progress |

### Key Interfaces (src/types.ts)

```typescript
interface Settings {
  ollamaBaseUrl: string        // default: 'http://localhost:11434'
  selectedModel: string        // default: 'gemma4:latest'
  systemPrompt: string         // Ghost AI system prompt
  suggestReplyPrompt: string   // template used by Suggest Reply / Auto; '{{transcript}}' is replaced at call time
  opacity: number              // window opacity 0-1 (default 0.9)
  fontSize: number             // UI font size in px (default 12)
  language: string             // default: 'pt-BR' (legacy, currently unused)
  transcriptionInterval: number // seconds between transcriptions 3-30 (default 10)
}

interface ChatMessage {
  id: string                   // crypto.randomUUID()
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean        // true while assistant response is streaming
  screenshot?: string          // base64 dataURL if screenshot attached
}
```

## Critical Technical Decisions

### Speaker diarization (hybrid: channel + voice clustering)
"Speakers" mode in `AudioCapture.tsx` labels who is talking. It combines two signals:
1. **Channel separation** — mic and system audio are captured into **separate PCM buffers** (`micChunksRef` / `systemChunksRef`) instead of being merged. Mic = "You"; system = the other side.
2. **Voice clustering (A/B/C)** — each system-audio chunk is sent to a local speaker-embedding model (`Xenova/wavlm-base-plus-sv` via `@huggingface/transformers`, loaded in the main process like Whisper). The returned L2-normalized embedding is clustered online by cosine similarity (`SPEAKER_SIM_THRESHOLD`, dot product since vectors are normalized); new speakers get the next letter (A, B, C…).

The transcript is stored as `TranscriptSegment[] = { speaker, text }` (consecutive same-speaker chunks merge). A formatted string (`You: … / A: …`) is what gets passed to Ollama, saved, and used as chat context. If the embedding model isn't ready or fails, system speech falls back to the label "Other" (channel-only) — it never crashes. Clustering granularity is one label per transcription chunk, so speakers that overlap within a chunk share a label; the `SPEAKER_SIM_THRESHOLD` constant is the accuracy knob to tune.

### Whisper runs in main process
The `@huggingface/transformers` library requires `fs` access for ONNX runtime. The renderer process (sandboxed) cannot access `fs`. All Whisper inference happens in the main process, with audio sent as `ArrayBuffer` over IPC.

### `net.fetch` override for model downloads
Node.js `undici` fetch fails on HuggingFace's 302 redirect chain inside Electron's main process. Before loading the transformers library, we override `globalThis.fetch = net.fetch` (Electron's Chromium network stack), then restore it after the model is loaded.

### Externalized dependencies in Vite
`@huggingface/transformers` and `onnxruntime-node` are externalized from Vite's bundling (in `vite.config.mts` rollupOptions.external). They are loaded via dynamic `import()` from `node_modules` at runtime. This avoids bundling issues with native modules and large WASM/ONNX files.

### Output format is CJS
Both `electron/main.ts` and `electron/preload.ts` are built as CommonJS (`format: 'cjs'`) because Electron's main process expects CJS by default.

### `electron-store` is listed but unused
`electron-store` is in `dependencies` but is not imported anywhere. Settings are kept in React state only (in-memory). Persisting settings to disk is a potential future feature.

### Transcript box is resizable via CSS `resize-y`
The transcript div uses `resize-y` with Tailwind classes (`h-24 min-h-[48px] max-h-[480px]`) instead of a React-controlled `style.height`. This is intentional: setting height via a React style prop would reset the user's drag on every re-render (which happens frequently during transcription). The native resize handle writes inline style directly to the DOM, bypassing React's reconciler.

### Model switching from the title bar
`Overlay.tsx` receives `models` (from `useGhostAI`) and `updateSettings` props. The model-switcher dropdown calls `updateSettings({ selectedModel })` directly — no navigation to Settings required.

### Auto button uses `useRef` to avoid stale closures
The `setInterval` in AudioCapture would capture a stale `autoSend` value. Instead, `autoSendRef = useRef(autoSend)` is kept in sync, and the interval callback reads `autoSendRef.current`. The Auto interval itself is a separate ref (`autoSendIntervalRef`, 10-120s) so changing the cadence from the UI restarts the timer without reloading Whisper.

### Audio stream auto-restart (macOS ScreenCaptureKit)
System-audio capture via `getDisplayMedia({ audio: 'loopback' })` can be killed by macOS after ~20 minutes (ScreenCaptureKit timeout). When the underlying track emits `onended`, `AudioCapture` sets `streamDied = true`, which triggers a `useEffect` that tears down the dead audio graph and re-requests the streams for the previously selected source — without clearing the accumulated transcript, the auto-send timer, or the duration counter.

### Tray and crop window
`createTray()` is gated behind `!VITE_DEV_SERVER_URL` (triggers `SetApplicationIsDaemon` on unsigned dev builds). The crop window created by `captureScreenshotCrop` runs an inline `data:` URL page with a fullscreen canvas, hides the main window during selection, and restores its bounds + visibility on finish.

### Tray is production-only
Creating a `Tray` in dev mode triggers `SetApplicationIsDaemon` errors on unsigned macOS builds. The tray and dock-hiding are gated behind `!VITE_DEV_SERVER_URL`.

### Permission handler is restricted
`setPermissionRequestHandler` only allows `media`, `microphone`, and `screen` permissions. All other permission requests are denied. Notably, the web clipboard API (`navigator.clipboard`) is blocked by this — clipboard writes are routed through the native `clipboard-write` IPC channel instead.

### Electron 39+ needs CoreAudio Tap disabled for system-audio loopback
On Electron 39+ (Chromium 142+) system-audio loopback comes up *live but silent* — the level meter never moves and no audio is captured. Root cause: Chromium 142 made Apple's new **CoreAudio Tap** API (`MacCatapLoopbackAudioForScreenShare`) the default for loopback. That API needs a brand-new `NSAudioCaptureUsageDescription` permission that can't be queried, so it fails silently with no fallback to the old API. The fix is to disable that feature at startup, **before app ready**, in `electron/main.ts`:

```ts
app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
```

This forces Chromium back onto the ScreenCaptureKit path, which uses the Screen Recording permission the app already requests. With that switch, `setDisplayMediaRequestHandler` returning `audio: 'loopback'` works on Electron 42. The version no longer needs to be held back at 38.x — it's pinned exactly in `package.json` only for build reproducibility. Ref: [electron/electron#49607](https://github.com/electron/electron/issues/49607). (Alternative future-proof fix: add `NSAudioCaptureUsageDescription` to the Info.plist and let users grant the new CoreAudio Tap permission instead of disabling it.)

## Adding New Features

### Adding a new audio action button (e.g., "Translate PT" pattern)

1. **Add prop to `AudioCaptureProps`** in `src/components/AudioCapture.tsx`:
   ```typescript
   interface AudioCaptureProps {
     onNewAction: (text: string) => void
     // ... existing props
   }
   ```
2. **Destructure the prop** in the component function signature
3. **Create a handler**:
   ```typescript
   const handleNewAction = useCallback(() => {
     if (!transcript.trim()) return
     onNewAction(transcript.trim())
   }, [transcript, onNewAction])
   ```
4. **Add the button** in the button row (after Summarize/Translate PT, before Save)
5. **Wire it in `Overlay.tsx`** by passing the callback with the appropriate prompt to `sendMessage()`
6. **Document in `HelpPanel.tsx`** under "Audio Buttons" section

### Adding a new IPC channel

1. **Main process** (`electron/main.ts`): Add handler with `ipcMain.handle('channel-name', ...)` or `ipcMain.on('channel-name', ...)`
2. **Preload** (`electron/preload.ts`): Add method to the `api` object using `ipcRenderer.invoke()` or `ipcRenderer.send()`
3. **Types** (`src/types.ts`): Add method signature to the `GhostAPI` interface
4. **Use in renderer**: Call via `window.ghostAPI.newMethod()`

### Adding a new view/panel

1. Add the view name to the `View` type union in `src/App.tsx`: `type View = 'overlay' | 'settings' | 'help' | 'newview'`
2. Create the component in `src/components/NewView.tsx` with an `onBack` prop
3. Add the conditional render in `App.tsx`
4. Add a button in `Overlay.tsx` title bar to navigate to it

### Adding a new setting

1. Add the field to `Settings` interface in `src/types.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/hooks/useGhostAI.ts`
3. Add the UI control in `src/components/Settings.tsx`
4. Use the value where needed (components read `settings.newField`)

## Gotchas and Pitfalls

- **`gemma3:4b` does NOT support audio input** - Audio must always be transcribed to text first via Whisper, then sent as text to Ollama.
- **Whisper model downloads ~118MB on first use** from HuggingFace, cached in `~/.cache/huggingface` after that. First launch is slow.
- **Speaker model (`wavlm-base-plus-sv`) downloads on first "Speakers" toggle** from HuggingFace, cached under `userData/whisper-models`. The model only runs in the main process; audio/embeddings never leave the machine. Tuning lives in `SPEAKER_SIM_THRESHOLD` (AudioCapture.tsx): too low merges different speakers into one, too high splits one person into many.
- **System audio on macOS requires Screen Recording permission** (not just microphone). The app uses `getDisplayMedia` with `audio: 'loopback'` via `setDisplayMediaRequestHandler`.
- **macOS 13+ required** for system audio capture (ScreenCaptureKit).
- **Silence detection threshold** is RMS 0.002 — audio below this is considered silence and skipped for transcription.
- **Hallucination filtering** — Whisper may hallucinate on silent/noisy input. Common hallucinations like repeated phrases or phantom text are filtered out in `AudioCapture.tsx`.
- **Window is always-on-top, floating level 1, visible on all workspaces** including fullscreen. This is intentional for overlay behavior.
- **Do NOT add any analytics, telemetry, or external API calls.** The entire project philosophy is zero data leaving the machine.
- **All user-facing text must be in English** (UI labels, button text, help descriptions, prompts). The system prompt and error messages are all English.
- **`language: 'pt-BR'` in Settings** is a legacy field — not currently used for anything. The Whisper transcription language is hardcoded to `'english'` in main.ts.
- **Error messages in `useGhostAI.ts`** still have some Portuguese strings (`"Erro: ..."`, `"Verifique se o Ollama..."`) that should be translated to English for consistency.

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+G` | Toggle overlay visibility (show/hide) |
| `Cmd+Shift+S` | Capture full screenshot and send to Ollama for analysis |
| `Cmd+Shift+X` | Open a fullscreen crop overlay, capture selected region, send to Ollama for analysis |
| `Cmd+Shift+A` | Focus the chat text input (shows overlay if hidden) |

## Testing

The project has a Vitest test suite (`npm test`). Currently **148 tests** across 9 test files under `src/__tests__/`.

### Running tests

```bash
npm test             # Run once
npm run test:watch   # Watch mode
```

### Test conventions

- **Framework**: Vitest + React Testing Library + `@testing-library/jest-dom`
- **`window.ghostAPI` mock**: defined in `src/__tests__/setup.ts` (all IPC methods are vi.fn()), re-created before each test via `beforeEach`. When adding new IPC methods to `ghostAPI`, add a matching `vi.fn()` mock to `setup.ts`.
- **Electron-specific APIs** (`ipcMain`, `ipcRenderer`, `clipboard`, etc.) are not directly tested — test the renderer behaviour through `window.ghostAPI` mocks instead.
- **Whisper and Ollama** are external services — mock their responses via `ghostAPI` mocks.
- **Audio APIs** (`AudioContext`, `MediaStream`, `mediaDevices`) are stubbed in `setup.ts`.
- **New components**: add a `src/__tests__/ComponentName.test.tsx` — see `MessageBubble.test.tsx` as a reference.

## Security Constraints

- No secrets, API keys, tokens, or private data in the codebase
- No external network calls except to `localhost` (Ollama) and `huggingface.co` (model download, first run only)
- Permission handler restricted to media/microphone/screen only
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (sandbox disabled only because Whisper needs main-process Node access)
- `package.json` has `"private": true` to prevent accidental npm publish
