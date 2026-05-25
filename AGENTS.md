# AGENTS.md - Ghost AI Project Guide

## Project Overview

Ghost AI is a **100% local, anonymous AI assistant** built as a macOS overlay app. It provides real-time suggestions during conversations, meetings, and interviews. Zero cloud, zero telemetry — all inference runs locally via Ollama and Whisper.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 33 |
| Frontend | React 18 + TypeScript 5 |
| Bundler | Vite 6 + vite-plugin-electron |
| Styling | TailwindCSS 3 |
| LLM | Ollama (default model: `gemma3:4b`) |
| Speech-to-Text | `@huggingface/transformers` v4 with `onnx-community/whisper-tiny` |
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
│   │   ├── AudioCapture.tsx  # Audio capture with source toggle, PCM, Whisper transcription
│   │   ├── ChatInput.tsx     # Text input with send
│   │   ├── MessageBubble.tsx # Chat message display
│   │   ├── Settings.tsx      # Settings panel (model, prompt, opacity, interval)
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
2. **Audio**: Mic/System audio -> Web Audio API (PCM capture at 16kHz) -> IPC `whisper-transcribe` -> main process runs Whisper pipeline -> text returned -> displayed in AudioCapture transcript area
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
| `save-conversation` | renderer->main | invoke | Show save dialog + write .txt |
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
  selectedModel: string        // default: 'gemma3:4b'
  systemPrompt: string         // Ghost AI system prompt
  opacity: number              // window opacity 0-1 (default 0.9)
  language: string             // default: 'pt-BR'
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

### Auto button uses `useRef` to avoid stale closures
The `setInterval` in AudioCapture would capture a stale `autoSend` value. Instead, `autoSendRef = useRef(autoSend)` is kept in sync, and the interval callback reads `autoSendRef.current`.

### Tray is production-only
Creating a `Tray` in dev mode triggers `SetApplicationIsDaemon` errors on unsigned macOS builds. The tray and dock-hiding are gated behind `!VITE_DEV_SERVER_URL`.

### Permission handler is restricted
`setPermissionRequestHandler` only allows `media`, `microphone`, and `screen` permissions. All other permission requests are denied.

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
| `Cmd+Shift+S` | Capture screenshot and send to Ollama for analysis |
| `Cmd+Shift+A` | Focus the chat text input (shows overlay if hidden) |

## Testing

There is currently no test suite. When adding tests:
- Use Vitest (compatible with Vite) for unit/integration tests
- Mock `window.ghostAPI` for renderer component tests
- Mock Electron's `ipcMain`/`ipcRenderer` for IPC tests
- Whisper and Ollama are external services — mock their responses

## Security Constraints

- No secrets, API keys, tokens, or private data in the codebase
- No external network calls except to `localhost` (Ollama) and `huggingface.co` (model download, first run only)
- Permission handler restricted to media/microphone/screen only
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (sandbox disabled only because Whisper needs main-process Node access)
- `package.json` has `"private": true` to prevent accidental npm publish
