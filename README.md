# Ghost AI

A local, anonymous AI assistant that runs entirely on your machine. Real-time suggestions, audio transcription, and screen analysis -- zero cloud, zero telemetry.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

## What It Does

Ghost AI is a floating overlay that sits on top of your screen and provides AI-powered assistance during meetings, calls, interviews, or any conversation. It captures audio, transcribes it locally using Whisper, and uses Ollama to generate suggestions -- all without sending a single byte to external servers.

### Key Features

- **100% Local & Anonymous** -- No data leaves your machine. No telemetry, analytics, or tracking.
- **Real-time Audio Transcription** -- Local Whisper model transcribes audio from your microphone, system audio (meetings/calls), or both simultaneously.
- **AI Suggestions** -- Ollama generates contextual reply suggestions based on live transcription.
- **Screenshot Analysis** -- Capture and analyze your screen content for code, presentations, or conversations.
- **Floating Overlay** -- Always-on-top transparent window that stays visible during any activity.
- **Conversation Export** -- Save chats and transcriptions to `.txt` files with AI-generated filenames.

## Prerequisites

- **macOS 13+** (for system audio capture via ScreenCaptureKit)
- **[Ollama](https://ollama.ai)** installed and running
- **Node.js 18+**

## Quick Start

```bash
# 1. Install Ollama and pull a model
ollama pull gemma3:4b

# 2. Make sure Ollama is running
ollama serve

# 3. Clone and install
git clone https://github.com/your-username/ghost-ai.git
cd ghost-ai
npm install

# 4. Start the app
npm run dev
```

The overlay window will appear on your screen. The Whisper model (~118MB) downloads automatically on first use and is cached for subsequent launches.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+G` | Show/Hide overlay |
| `Cmd+Shift+S` | Capture screenshot & analyze |
| `Cmd+Shift+A` | Focus text input |
| `Esc` | Clear text input |
| `Enter` | Send message |

## How It Works

```
Audio Source (Mic/System/Both)
    |
    v
Raw PCM capture (ScriptProcessorNode)
    |
    v
Resample to 16kHz + Silence detection
    |
    v
Whisper (onnx-community/whisper-tiny, runs in main process)
    |
    v
Transcribed text
    |
    v
Ollama (local LLM) --> Suggestions / Summaries
```

### Audio Sources

| Source | What It Captures | Use Case |
|--------|-----------------|----------|
| **Mic** | Your microphone | Dictation, voice notes |
| **System** | Desktop audio via ScreenCaptureKit | Meetings, calls, videos |
| **Both** | Mic + system mixed | Full conversation capture |

> System audio requires **Screen Recording** permission (System Settings > Privacy & Security > Screen Recording).

## Project Structure

```
ghost-ai/
  electron/
    main.ts          # Main process: window, tray, shortcuts, IPC, Whisper
    preload.ts       # Context bridge (ghostAPI)
  src/
    App.tsx           # Root component, view routing
    components/
      Overlay.tsx     # Main overlay UI, title bar, chat, quick actions
      ChatInput.tsx   # Message input field
      MessageBubble.tsx # Chat message display
      AudioCapture.tsx  # Audio capture, transcription, source toggle
      Settings.tsx    # Settings panel
      HelpPanel.tsx   # Help & reference panel
    hooks/
      useGhostAI.ts   # Ollama integration, settings, chat state
      useWhisper.ts   # Whisper IPC bridge
    types.ts          # TypeScript interfaces
    styles/
      globals.css     # Tailwind + custom glass/animation styles
  vite.config.mts     # Vite + Electron plugin config
```

## Settings

Access via the gear icon or tray menu:

| Setting | Description | Default |
|---------|-------------|---------|
| Ollama Base URL | Ollama API endpoint | `http://localhost:11434` |
| Model | Active LLM model | `gemma3:4b` |
| System Prompt | Instructions for the AI | English, concise, contextual |
| Opacity | Window transparency | 90% |
| Transcription Interval | Seconds between Whisper processing | 10s (3-30s range) |

## Building for Production

```bash
# macOS
npm run dist:mac

# Windows
npm run dist:win
```

Output goes to the `release/` directory.

> Note: Unsigned macOS dev builds may show a `SetApplicationIsDaemon` warning -- this is a harmless Chromium subprocess issue that disappears in signed production builds.

## Technical Details

- **Whisper runs in the main process** -- the renderer can't access `fs` which the transformers library needs internally.
- **`@huggingface/transformers` v4** with `onnx-community/whisper-tiny` (~118MB `decoder_model_merged.onnx`).
- **`net.fetch` override** -- Electron's Chromium network stack is used for model downloads because Node's undici fetch fails on HuggingFace's 302 redirect chain.
- **Externalized from Vite** -- `@huggingface/transformers` and `onnxruntime-node` are loaded at runtime via dynamic `import()` from `node_modules`.
- **Silence detection** (RMS threshold 0.002) and **hallucination filtering** prevent Whisper from generating false output on silence/noise.
- **Permission handler** only grants `media`, `microphone`, and `screen` permissions -- nothing else.

## Privacy

Ghost AI is designed with privacy as a core principle:

- All AI inference runs locally via Ollama
- Audio transcription runs locally via Whisper
- No external API calls (except HuggingFace CDN for initial model download)
- No telemetry, analytics, cookies, or tracking
- No accounts, no sign-up, no cloud sync
- Conversations are stored in memory only (lost on restart unless saved to file)

## License

MIT
