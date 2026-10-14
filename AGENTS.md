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
| Speech-to-Text | `@huggingface/transformers` v4 with Whisper (default `onnx-community/whisper-base`; tiny/base/small and `.en` variants selectable in Settings) |
| Settings persistence | `electron-store` v8 (`userData/settings.json`) |
| Speaker ID (diarization) | `@huggingface/transformers` v4 with `Xenova/wavlm-base-plus-sv` |
| Package manager | npm |
| Build/Dist | electron-builder (DMG + ZIP for macOS, NSIS for Windows) |

## Project Structure

```
Ghost-AI-Local/
├── electron/
│   ├── main.ts          # Main process: window, tray, shortcuts, IPC, Whisper, settings store
│   └── preload.ts       # contextBridge exposing ghostAPI to renderer
├── src/
│   ├── App.tsx           # Root component, view routing (overlay | settings | help)
│   ├── main.tsx          # React entry point
│   ├── types.ts          # All TypeScript interfaces (GhostAPI, Settings, ChatMessage, etc.)
│   ├── components/
│   │   ├── Overlay.tsx       # Main UI: chat, quick actions, audio, save, welcome screen
│   │   ├── AudioCapture.tsx  # Audio capture: source toggle, per-channel PCM, Whisper transcription, speaker diarization (You/A/B/C), Auto mode, auto-restart on stream death
│   │   ├── ChatInput.tsx     # Text input with send / Stop (Esc) and queued count
│   │   ├── Markdown.tsx      # Reply rendering: GFM + highlighted code, no links/images/HTML
│   │   ├── MessageBubble.tsx # Chat message: Markdown reply, collapsible reasoning, copy, Save .md on meeting notes
│   │   ├── Settings.tsx      # Settings panel (model, context window, preset editor, appearance, Whisper model/language, transcription)
│   │   └── HelpPanel.tsx     # Help reference (shortcuts, buttons, descriptions)
│   ├── hooks/
│   │   ├── useGhostAI.ts     # Core hook: Ollama streaming, settings, connection check, token-budgeted history
│   │   ├── useTranscriptContext.ts # Progressive transcript summary → per-request context
│   │   └── useWhisper.ts     # Whisper hook: IPC bridge, progress tracking, model/language, reload detection
│   ├── lib/
│   │   ├── context.ts        # Token estimates, history budget, transcript delta/tail, compaction planning
│   │   ├── filename.ts       # AI-generated file names (shared by every Save) + date stamps
│   │   ├── notes.ts          # Meeting notes: prompt, budget fitting, Markdown export
│   │   ├── ollama.ts         # Local-URL check, cloud-model detection, stream-line parsing (also used by electron/main.ts)
│   │   ├── presets.ts        # Built-in prompt presets, CRUD, merge/validation, {{transcript}} filling
│   │   ├── segmenter.ts      # Energy VAD: closes speech segments on a ~700ms pause or max length
│   │   ├── settings.ts       # mergeSettings(): stored settings over DEFAULT_SETTINGS
│   │   └── whisper.ts        # Whisper models/languages + pipeline options (also imported by electron/main.ts)
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
│                     │                      │  - Settings store    │
└─────────────────────┘                      └──────────────────────┘
```

### Data Flow

1. **Chat**: User input -> `useGhostAI.sendMessage()` (queued if a reply is streaming) -> IPC `ollama-chat-stream` with a `requestId` -> main process `fetch()` to Ollama -> chunks `{ requestId, content, thinking }` back via `webContents.send('ollama-stream-chunk')` -> renderer updates that reply in real time -> the invoke resolves with the final `{ content, thinking, aborted? }`
2. **Audio**: Mic/System audio -> Web Audio API (per-channel AudioWorklet PCM capture) -> `SpeechSegmenter` VAD (segment closes on a pause or at `transcriptionInterval`) -> serial queue -> resample to 16kHz -> IPC `whisper-transcribe` (with `settings.transcriptionLanguage`) -> main process runs the Whisper pipeline loaded for `settings.whisperModel` -> text returned. With "Speakers" on, system-audio chunks also go through IPC `embed-speaker` -> main process speaker-embedding model -> embedding clustered in the renderer into A/B/C. Result is displayed as labeled segments in the AudioCapture transcript area
3. **Screenshot**: Global shortcut or button -> `desktopCapturer.getSources()` -> base64 dataURL -> sent to Ollama as context with analysis prompt
4. **Settings**: on startup `useGhostAI` calls IPC `settings-load` -> `mergeSettings(DEFAULT_SETTINGS, stored)`; every later change is written back with `settings-save`
5. **Meeting notes**: Notes button (or the offer after Stop) -> `Overlay` builds the request from `useTranscriptContext().getContext()` via `buildMeetingNotesRequest` -> `sendMessage(..., { systemPrompt, standalone: true, kind: 'notes' })` streams the Markdown into the chat -> **Save .md** on that reply -> IPC `save-conversation` with `format: 'md'`

### IPC Channel Map

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `ollama-chat` | renderer->main | invoke | Non-streaming Ollama chat; optional `think: false` turns off reasoning on thinking models (AI file names, background summary) |
| `ollama-chat-stream` | renderer->main | invoke | Streaming chat `{ requestId, ..., think? }`; resolves `{ success, content, thinking, aborted?, error? }` when the stream ends |
| `ollama-abort` | renderer->main | invoke | Stop the streaming request with that `requestId` (Stop button / Esc) |
| `ollama-status` | renderer->main | invoke | Connection + local models from one `/api/tags` (3s timeout, polled every 10s); cloud models filtered out, `error` for a non-local URL |
| `capture-screenshot` | renderer->main | invoke | desktopCapturer screenshot |
| `whisper-load` | renderer->main | invoke | Load Whisper model `(modelId)`; a different id disposes the loaded pipeline and loads the new one (serialized) |
| `whisper-transcribe` | renderer->main | invoke | Transcribe Float32Array audio `(buffer, language)`; `'auto'` = detect |
| `whisper-status` | renderer->main | invoke | Get current Whisper status (+ loaded `model`) |
| `embed-load` | renderer->main | invoke | Load speaker-embedding model (diarization) |
| `embed-speaker` | renderer->main | invoke | Return normalized speaker embedding for Float32Array audio |
| `embed-status` | renderer->main | invoke | Get speaker-embedding model status |
| `embed-progress` | main->renderer | send | Speaker model download progress |
| `save-conversation` | renderer->main | invoke | Show save dialog + write the file; `format: 'txt'` (default) or `'md'` picks the filter/extension |
| `settings-load` | renderer->main | invoke | Read stored settings (`{ settings: object \| null }`, raw — the renderer merges) |
| `settings-save` | renderer->main | invoke | Write the settings object to `userData/settings.json` |
| `clipboard-write` | renderer->main | invoke | Write text to native clipboard (bypasses web permission handler) |
| `request-mic-permission` | renderer->main | invoke | macOS microphone access |
| `get-mic-status` | renderer->main | invoke | Check mic permission status |
| `window-minimize` | renderer->main | send | Hide window |
| `window-close` | renderer->main | send | Quit app |
| `window-move` | renderer->main | send | Reposition window |
| `window-resize` | renderer->main | send | Resize window |
| `set-opacity` | renderer->main | send | Set window opacity |
| `set-ignore-mouse` | renderer->main | send | Click-through toggle |
| `ollama-stream-chunk` | main->renderer | send | Streaming chunk `{ requestId, content, thinking }` |
| `screenshot-captured` | main->renderer | send | Screenshot from shortcut |
| `focus-input` | main->renderer | send | Focus chat input |
| `open-settings` | main->renderer | send | Open settings view |
| `overlay-visibility` | main->renderer | send | Visibility state changed |
| `whisper-progress` | main->renderer | send | Model download progress (includes `model`) |

### Key Interfaces (src/types.ts)

```typescript
interface Settings {
  ollamaBaseUrl: string        // default: 'http://localhost:11434'
  selectedModel: string        // default: 'gemma4:latest'
  opacity: number              // window opacity 0-1 (default 0.9)
  fontSize: number             // UI font size in px (default 12)
  transcriptionInterval: number // max speech-segment length in seconds 3-30 (default 10), live
  speakerThreshold: number     // cosine-similarity threshold for speaker separation 0.5-0.95 (default 0.85)
  contextLength: number        // Ollama num_ctx sent with every chat request (default 8192)
  whisperModel: string         // Hugging Face id from WHISPER_MODELS (default 'onnx-community/whisper-base')
  transcriptionLanguage: string // 'auto' | 'english' | 'portuguese' | ... (default 'english'); replaced the legacy `language`
  presets: Preset[]            // built-ins first (General, Technical interview, Sales call, Lecture/Class), then user presets
  activePresetId: string       // default 'general'
  reasoning: boolean           // default true: thinking models reason (shown above the reply); false sends think: false
}

interface Preset {
  id: string
  name: string
  systemPrompt: string         // system prompt for every chat request
  suggestReplyPrompt: string   // template used by Suggest Reply / Auto; '{{transcript}}' is replaced at call time
  quickActions: { label: string; prompt: string }[] // chat quick-action pills
}

interface ChatMessage {
  id: string                   // crypto.randomUUID()
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean        // true while assistant response is streaming
  screenshot?: string          // base64 dataURL if screenshot attached
  thinking?: string            // the model's reasoning (thinking models), shown collapsible
  stopped?: boolean            // generation stopped by the user (partial reply kept)
  kind?: 'notes'               // meeting-notes reply (bubble offers Save .md)
}
```

## Critical Technical Decisions

### Speaker diarization (hybrid: channel + voice clustering)
"Speakers" mode in `AudioCapture.tsx` labels who is talking. It combines two signals:
1. **Channel separation** — mic and system audio are captured into **separate PCM buffers** (`micChunksRef` / `systemChunksRef`) instead of being merged. Mic = "You"; system = the other side.
2. **Voice clustering (A/B/C)** — each system-audio chunk is sent to a local speaker-embedding model (`Xenova/wavlm-base-plus-sv` via `@huggingface/transformers`, loaded in the main process like Whisper). The returned L2-normalized embedding is clustered online by cosine similarity (threshold = `settings.speakerThreshold`, read via `speakerThresholdRef`; dot product since vectors are normalized); new speakers get the next letter (A, B, C…).

The transcript is stored as `TranscriptSegment[] = { speaker, text }` (consecutive same-speaker chunks merge). A formatted string (`You: … / A: …`) is what gets passed to Ollama, saved, and used as chat context. If the embedding model isn't ready or fails, system speech falls back to the label "Other" (channel-only) — it never crashes. Clustering granularity is one label per transcription chunk, so speakers that overlap within a chunk share a label; the **Speaker Separation** setting (`settings.speakerThreshold`, default 0.85, exposed as a Settings slider) is the accuracy knob — higher separates more speakers, lower merges similar voices, and it applies live to the next chunk.

### Context management (num_ctx + token budget)
Every `ollama-chat` / `ollama-chat-stream` request sends `options: { num_ctx: settings.contextLength }` — without it Ollama silently truncates to its small default window. `src/lib/context.ts` estimates tokens (~4 chars/token) and `promptBudget()` reserves room for the reply (25% of the window, max 2048). `useGhostAI.sendMessage(content, screenshot?, { context, systemPrompt?, standalone?, kind? })` builds: system prompt (the active preset's, unless overridden) → transcript system message → chat history trimmed newest-first to the remaining budget (`fitHistoryToBudget`, replacing the old fixed `slice(-20)`). `standalone: true` leaves the chat history out (meeting notes).

The **live transcript is never embedded in user messages or stored in history**. `Overlay` passes it as `context` on each request (typed questions, quick actions, Suggest reply, Auto, Summarize, Summary PT). `useTranscriptContext` keeps it bounded: once the unsummarized transcript passes ~40% of the prompt budget, the older part is folded into a running summary in the background via `ollamaChat` (at most half the budget per pass; 30s backoff on failure) and only the recent ~15% stays verbatim. Clearing/restarting the transcript drops the summary. If summarization lags, the verbatim part is still capped (`transcriptTail`).

Auto mode sends only the text added since its last send (`transcriptDelta`); the manual Suggest reply button sends the last ~300 tokens (`transcriptTail`). Both fill `{{transcript}}` in the active preset's `suggestReplyPrompt` with that excerpt (`fillSuggestReplyPrompt`; a template without the placeholder gets the excerpt appended).

### Streaming: request ids, Stop, queue
Every streaming request gets a `requestId` (`useGhostAI.startRequest`). The main process keeps an `AbortController` per id (`activeStreams`), tags each `ollama-stream-chunk` with it, and resolves the `ollama-chat-stream` invoke with the final content once the stream ends — there is no separate "done" event, so a stale or late chunk can never land in another reply. `stopGeneration()` calls `ollama-abort(id)`; the reply keeps its partial text and is marked `stopped`. While a reply streams, `sendMessage` queues new requests (screenshot shortcut, Notes, Summarize, quick actions; at most `MAX_QUEUED_REQUESTS` = 3, oldest dropped) and they run in order afterwards with the settings of that moment. Auto mode is not queued: `Overlay` returns `false` so Auto retries its delta on the next tick. Clear chat aborts the active request and drops the queue.

### Reasoning (thinking models)
`settings.reasoning` (default **on**) leaves `think` out of chat requests, so thinking models (capability `thinking` in `/api/tags`, e.g. qwen3) reason and the reasoning streams separately into `ChatMessage.thinking`, shown live in a collapsible block above the reply. Off sends `think: false`. Never send `think: true`: Ollama rejects it for models without the capability. Background calls (file names, progressive summary) always send `think: false` — reasoning there only delays them and blocks Ollama for the chat.

### Markdown replies
Assistant replies render through `Markdown.tsx` (`react-markdown` + `remark-gfm` + `rehype-highlight`; styles in `globals.css` under `.response-content`). For the zero-network rule nothing in a reply may load or navigate: raw HTML stays disabled (react-markdown default — do not add `rehype-raw`), links render as text with the URL as a tooltip, and images become `[image: alt]`. Code blocks get a copy button. User messages stay plain text.

### Prompt presets
`src/lib/presets.ts` defines the `Preset` built-ins and pure CRUD helpers (`createPreset`, `duplicatePreset`, `renamePreset`, `updatePreset`, `deletePreset`, `restorePreset`). Built-ins are recognized by id: they can be edited and restored but `deletePreset` is a no-op for them, and `mergePresets` re-adds any that are missing from the stored list (an edited stored copy wins). `getActivePreset(settings)` feeds `useGhostAI` (system prompt) and `Overlay` (Suggest reply/Auto template and the quick-action pills, which replace the old fixed Summarize / Suggest reply / Next steps). The preset editor in `Settings.tsx` edits a local copy, committed only on Save; the title-bar preset dropdown calls `updateSettings({ activePresetId })`.

### Meeting notes
Notes are generated through the normal streaming `sendMessage` so they appear in the chat. `buildMeetingNotesRequest(context, contextLength)` (`src/lib/notes.ts`) puts the format rules in a one-off system prompt (sections Summary / Key decisions / Action items / Open questions; action items as `- [ ] task — owner`, owners taken from the You/A/B/C labels detected in the transcript; written in the conversation's language via `notesLanguage()` — the chosen `transcriptionLanguage`, English for `.en` models, or the transcript's own language on Auto-detect — while the section headings stay in English), and trims the transcript context so instructions + context + request fit `promptBudget`. The reply is tagged `kind: 'notes'`; its **Save .md** button wraps it with `notesDocument()` (title + date/model/preset line) and saves via `save-conversation` with `format: 'md'`, reusing the shared AI file-name helper (`suggestFilename` in `src/lib/filename.ts`).

### Audio capture: AudioWorklet + VAD segmenter
Each channel's PCM is captured by an `AudioWorkletNode` (`ghost-capture`, inline module loaded from a Blob URL, 2048-sample batches posted to the main thread). When `audioContext.audioWorklet` is missing (jsdom tests) or fails to load, a `ScriptProcessorNode` is used instead. PCM goes through a per-channel `SpeechSegmenter` (`src/lib/segmenter.ts`): 20 ms frames, RMS vs an adaptive noise floor (starts at 0, falls fast in silence, rises slowly during speech), 200 ms pre-roll, segment closes after ~700 ms of silence or at `transcriptionInterval` (forced cuts happen at the quietest frame of the last second). Closed segments go into a serial queue (max 30, oldest dropped) transcribed one at a time in spoken order. Stop and stream auto-restart flush the open segment first. Changing the interval in Settings updates running segmenters.

### Whisper runs in main process
The `@huggingface/transformers` library requires `fs` access for ONNX runtime. The renderer process (sandboxed) cannot access `fs`. All Whisper inference happens in the main process, with audio sent as `ArrayBuffer` over IPC.

### Whisper model and language selection
`settings.whisperModel` picks one of `WHISPER_MODELS` (`src/lib/whisper.ts`: tiny/base/small, each multilingual or `.en`; fp32 downloads of ~150 MB / ~290 MB / ~970 MB). `whisper-load(model)` in `main.ts` only accepts ids from that list, keeps a single pipeline, and serializes loads (`loadWhisper`): a request for the model already loading shares that load, a different one waits, then disposes the current pipeline (after any in-flight transcription) and loads the new one with progress on `whisper-progress`. `whisper-transcribe(buffer, language)` builds its options with `whisperGenerateOptions(loadedModel, language)`: `.en` models get neither `language` nor `task` (transformers.js throws on them), `'auto'` omits `language`, anything else passes the language name. `main.ts` imports `src/lib/whisper.ts` directly — that is why `tsconfig.json` no longer uses project `references`/`composite` (a file can't belong to both projects otherwise).

In the renderer, `useWhisper(model, language)` reports `needsReload` when the loaded model differs from the selected one. `AudioCapture` reloads right away when idle; while recording it shows a notice and reloads after Stop (the queue drains first). The language is read through a ref, so a change applies to the next phrase. Whisper isn't loaded until persisted settings are in (`canLoadWhisper` ← `settingsLoaded`) so the default model isn't downloaded when another one was saved.

### `net.fetch` override for model downloads
Node.js `undici` fetch fails on HuggingFace's 302 redirect chain inside Electron's main process. Before loading the transformers library, we override `globalThis.fetch = net.fetch` (Electron's Chromium network stack), then restore it after the model is loaded.

### Externalized dependencies in Vite
`@huggingface/transformers` and `onnxruntime-node` are externalized from Vite's bundling (in `vite.config.mts` rollupOptions.external). They are loaded via dynamic `import()` from `node_modules` at runtime. This avoids bundling issues with native modules and large WASM/ONNX files.

### Output format is CJS
Both `electron/main.ts` and `electron/preload.ts` are built as CommonJS (`format: 'cjs'`) because Electron's main process expects CJS by default.

### Settings persistence (`electron-store`)
Settings are stored by `electron-store` v8 (CJS, externalized in `vite.config.mts`) as `userData/settings.json` via `settings-load` / `settings-save`. The main process stores the object as-is; the renderer owns the schema. On load, `mergeSettings(DEFAULT_SETTINGS, stored)` (`src/lib/settings.ts`) keeps only known keys whose type matches the default, so fields added later (e.g. `contextLength`, `whisperModel`, `presets`) get defaults and obsolete ones (the legacy `language`, the old top-level `systemPrompt`/`suggestReplyPrompt`) are dropped; it also validates the Whisper model/language and the active preset id. `useGhostAI` doesn't save until the load finished (`settingsLoaded`), then saves on every change. Ollama's "auto-select first model" also waits for the load, so it can't be overwritten by it.

### Transcript box is resizable via CSS `resize-y`
The transcript div uses `resize-y` with Tailwind classes (`h-24 min-h-[48px] max-h-[480px]`) instead of a React-controlled `style.height`. This is intentional: setting height via a React style prop would reset the user's drag on every re-render (which happens frequently during transcription). The native resize handle writes inline style directly to the DOM, bypassing React's reconciler.

### Model and preset switching from the title bar
`Overlay.tsx` receives `models` (from `useGhostAI`) and `updateSettings` props. The model-switcher dropdown calls `updateSettings({ selectedModel })` directly — no navigation to Settings required. The preset switcher next to it uses the same dropdown pattern (and `useClickOutside`) with `updateSettings({ activePresetId })`.

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

### Adding a new audio action button (e.g., "Summary PT" / "Notes" pattern)

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
4. **Add the button** in the button row (after Summarize/Summary PT, before Save)
5. **Wire it in `Overlay.tsx`** by passing the callback with the appropriate prompt to `sendMessage()`
6. **Document in `HelpPanel.tsx`** under "Audio Buttons" section

### Adding a new IPC channel

1. **Main process** (`electron/main.ts`): Add handler with `ipcMain.handle('channel-name', ...)` or `ipcMain.on('channel-name', ...)`
2. **Preload** (`electron/preload.ts`): Add method to the `api` object using `ipcRenderer.invoke()` or `ipcRenderer.send()`
3. **Types** (`src/types.ts`): Add method signature to the `GhostAPI` interface
4. **Use in renderer**: Call via `window.ghostAPI.newMethod()`
5. **Test mock**: add a matching `vi.fn()` to `src/__tests__/setup.ts`

### Adding a new view/panel

1. Add the view name to the `View` type union in `src/App.tsx`: `type View = 'overlay' | 'settings' | 'help' | 'newview'`
2. Create the component in `src/components/NewView.tsx` with an `onBack` prop
3. Add the conditional render in `App.tsx`
4. Add a button in `Overlay.tsx` title bar to navigate to it

### Adding a new setting

1. Add the field to `Settings` interface in `src/types.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/hooks/useGhostAI.ts` — `mergeSettings` then fills it in for users whose stored settings predate it (add a validity check there if not every value of that type is acceptable)
3. Add the UI control in `src/components/Settings.tsx`
4. Use the value where needed (components read `settings.newField`). It is persisted automatically
5. Tests build settings with `makeSettings()` from `src/__tests__/fixtures.ts`, so fixtures pick up the default

## Gotchas and Pitfalls

- **`gemma3:4b` does NOT support audio input** - Audio must always be transcribed to text first via Whisper, then sent as text to Ollama.
- **Whisper downloads the selected model on first use** (~290 MB for the default `whisper-base`; ~150 MB tiny, ~970 MB small) from HuggingFace, cached under `userData/whisper-models` after that. First launch, and the first use of a newly selected model, is slow.
- **Speaker model (`wavlm-base-plus-sv`) downloads on first "Speakers" toggle** from HuggingFace, cached under `userData/whisper-models`. The model only runs in the main process; audio/embeddings never leave the machine. Tuning lives in the **Speaker Separation** Settings slider (`settings.speakerThreshold`): too low merges different speakers into one, too high splits one person into many.
- **System audio on macOS requires Screen Recording permission** (not just microphone). The app uses `getDisplayMedia` with `audio: 'loopback'` via `setDisplayMediaRequestHandler`.
- **macOS 13+ required** for system audio capture (ScreenCaptureKit).
- **Silence detection**: RMS 0.002 is the absolute floor for speech in the VAD segmenter (above an adaptive noise floor) and a final silence check before Whisper.
- **Hallucination filtering** — Whisper may hallucinate on silent/noisy input. Common hallucinations like repeated phrases or phantom text are filtered out in `AudioCapture.tsx`.
- **Window is always-on-top, floating level 1, visible on all workspaces** including fullscreen. This is intentional for overlay behavior.
- **Do NOT add any analytics, telemetry, or external API calls.** The entire project philosophy is zero data leaving the machine.
- **All user-facing text must be in English** (UI labels, button text, help descriptions, prompts). The system prompt and error messages are all English.
- **Transcription language** comes from `settings.transcriptionLanguage` (default `'english'`). `'auto'` detects per VAD segment, which can flip languages on short phrases; `.en` models ignore the setting. The old `language: 'pt-BR'` field is gone (dropped by `mergeSettings`).
- **Built-in presets can't be deleted** — only edited and restored. Keep their ids (`general`, `technical-interview`, `sales-call`, `lecture`) stable: stored edits are matched by id.

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+G` | Toggle overlay visibility (show/hide) |
| `Cmd+Shift+S` | Capture full screenshot and send to Ollama for analysis |
| `Cmd+Shift+X` | Open a fullscreen crop overlay, capture selected region, send to Ollama for analysis |
| `Cmd+Shift+A` | Focus the chat text input (shows overlay if hidden) |

## Testing

The project has a Vitest test suite (`npm test`). Currently **344 tests** across 19 test files under `src/__tests__/`.

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
- **Settings fixtures**: use `makeSettings(overrides)` from `src/__tests__/fixtures.ts` (real defaults; `systemPrompt` / `suggestReplyPrompt` overrides go to the General preset).
- **Pure logic** in `src/lib/` gets its own `*.test.ts` (see `segmenter.test.ts`, `presets.test.ts`, `whisper.test.ts`, `notes.test.ts`, `mergeSettings.test.ts`).

## Security Constraints

- No secrets, API keys, tokens, or private data in the codebase
- No external network calls except to `localhost` (Ollama) and `huggingface.co` (model download, first use of each model only)
- Settings (incl. prompts) are stored only locally in `userData/settings.json`; `whisper-load` only accepts model ids from `WHISPER_MODELS`
- **Ollama must be local**: `isLocalOllamaUrl` (`src/lib/ollama.ts`) accepts only `localhost`/`*.localhost`, `127.0.0.0/8` and `::1` over http(s). The main process checks it on every Ollama request (`blockedOllamaRequest`), Settings won't save another URL, and `mergeSettings` resets a stored one. **Cloud models** (`remote_host` in `/api/tags`, or a `-cloud`/`:cloud` name) are proxied by the local Ollama to ollama.com, so they are hidden from the model list and refused by the main process
- Permission handler restricted to media/microphone/screen only
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (sandbox disabled only because Whisper needs main-process Node access)
- `package.json` has `"private": true` to prevent accidental npm publish
