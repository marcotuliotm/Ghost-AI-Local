# Ghost AI

A local, anonymous AI assistant that runs entirely on your machine. Real-time suggestions, audio transcription, and screen analysis -- zero cloud, zero telemetry.

![Electron](https://img.shields.io/badge/Electron-38-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## What It Does

Ghost AI is a floating overlay that sits on top of your screen and provides AI-powered assistance during meetings, calls, interviews, or any conversation. It captures audio, transcribes it locally using Whisper, and uses Ollama to generate suggestions -- all without sending a single byte to external servers.

### Key Features

- **100% Local & Anonymous** -- No data leaves your machine. No telemetry, analytics, or tracking.
- **Real-time Audio Transcription** -- Local Whisper model transcribes audio from your microphone, system audio (meetings/calls), or both simultaneously.
- **Resizable Transcript Box** -- Drag the bottom edge of the transcript area to adjust its height on the fly.
- **AI Suggestions** -- Ollama generates contextual reply suggestions based on live transcription.
- **Conversation Summarization** -- Summarize transcribed conversations into bullet points.
- **Screenshot Analysis** -- Capture and analyze your screen content for code, presentations, or conversations.
- **Floating Overlay** -- Always-on-top transparent window that stays visible during any activity.
- **Quick Model Switching** -- Switch the active Ollama model from the title bar without opening Settings.
- **Per-message Copy** -- Copy any chat message to the clipboard with a single click.
- **Conversation Export** -- Save chats and transcriptions to `.txt` files with AI-generated filenames.

---

## Prerequisites

Before installing Ghost AI, make sure you have:

### 1. macOS 13+ (Ventura or later)

Required for system audio capture via ScreenCaptureKit. Ghost AI runs as a native macOS application.

### 2. Ollama

Ollama is the local AI engine that powers Ghost AI. It runs large language models entirely on your machine.

**Install Ollama:**

- Download from [ollama.ai](https://ollama.ai), or
- Install via Homebrew:

```bash
brew install ollama
```

**Pull a model** (the default is `gemma3:4b`, ~3GB download):

```bash
ollama pull gemma3:4b
```

**Other recommended models:**

| Model | Size | Best For |
|-------|------|----------|
| `gemma3:4b` | ~3GB | Default, fast, good for suggestions |
| `llama3.2` | ~2GB | Good general purpose |
| `mistral` | ~4GB | Strong reasoning and coding |
| `gemma3:12b` | ~8GB | Higher quality, needs more RAM |

> **Important:** Ollama must be running before you start Ghost AI. Run `ollama serve` in a terminal or let it start automatically.

### 3. Node.js 18+ (only for building from source)

Not needed if you install from the DMG.

---

## Installation

### Option A: DMG Installer (Recommended)

1. Download `Ghost AI-1.0.0-arm64.dmg` from the releases
2. Open the DMG file
3. Drag **Ghost AI** to your **Applications** folder
4. Open Ghost AI from Applications

**First launch on macOS (unsigned app):**

Since the app is not signed with an Apple Developer certificate, macOS may block it on first launch:

- If you see _"Ghost AI cannot be opened"_: go to **System Settings > Privacy & Security**, scroll down and click **"Open Anyway"**
- Alternatively: right-click the app > **Open** > **Open**

### Option B: From Source

```bash
# Clone the repository
git clone https://github.com/your-username/ghost-ai.git
cd ghost-ai

# Install dependencies
npm install

# Run in development mode
npm run dev
```

---

## Required Permissions

Ghost AI needs specific macOS permissions to function. Grant them when prompted, or configure manually:

**System Settings > Privacy & Security:**

| Permission | Why It's Needed | Required? |
|-----------|-----------------|-----------|
| **Microphone** | Capture your voice for transcription | Yes, for mic capture |
| **Screen Recording** | Capture system audio from meetings/calls/videos | Yes, for system audio |
| **Accessibility** | Global keyboard shortcuts when app is in background | Optional |

> Without Screen Recording permission, only microphone capture works. System audio (meetings, calls, videos) won't be available.

---

## Using Ghost AI

### Getting Started

1. Make sure Ollama is running (green dot in the overlay = connected)
2. The Whisper speech model (~118MB) downloads automatically on first launch and is cached for future use
3. The overlay window floats on top of everything and can be dragged anywhere

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+G` | Show/Hide overlay |
| `Cmd+Shift+S` | Capture screenshot & analyze |
| `Cmd+Shift+A` | Focus text input |
| `Esc` | Clear text input |
| `Enter` | Send message |

### Title Bar Buttons

| Button | Action |
|--------|--------|
| Monitor icon | Opens a dropdown to switch the active Ollama model instantly |
| Camera | Captures the full screen and sends it to Ollama for analysis |
| Crop | Captures a selected screen region and sends it to Ollama |
| Download | Saves the full chat to a `.txt` file with an AI-generated filename |
| Trash | Clears all messages from the current conversation |
| Gear | Opens the Settings panel |
| Question mark | Opens the Help panel with full reference |
| Minus | Hides the window (use `Cmd+Shift+G` to bring it back) |
| ✕ | Quits the app |

### Audio Transcription

Select your audio source and click the record button:

| Source | What It Captures | Use Case |
|--------|-----------------|----------|
| **Mic** | Your microphone | Dictation, voice notes |
| **System** | Desktop audio via ScreenCaptureKit | Meetings, calls, videos |
| **Both** | Mic + system mixed | Full conversation capture |

Transcribed text appears in real time. **Drag the bottom edge** of the transcript box to resize it vertically. Use the action buttons:

| Button | Action |
|--------|--------|
| **Suggest reply** | AI suggests a natural response to continue the conversation |
| **Summarize** | AI summarizes the transcription into bullet points |
| **Auto** | Automatically sends each transcribed chunk to AI for suggestions |
| **Save** | Exports transcription to a `.txt` file |
| **Clear** | Clears the accumulated transcription |

### Chat Messages

Each message bubble has a **copy button** (appears on hover, top-right corner) that copies the message text to the clipboard. A ✓ checkmark confirms the copy.

### Quick Actions (Chat)

After the first AI response, quick action buttons appear:

- **Summarize** -- Summarizes the conversation into key points
- **Suggest reply** -- Suggests what you should respond based on context
- **Next steps** -- Suggests the logical next steps

---

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

---

## Settings

Access via the gear icon or tray menu:

| Setting | Description | Default |
|---------|-------------|---------|
| Ollama Base URL | Ollama API endpoint | `http://localhost:11434` |
| Model | Active LLM model (also switchable from the title bar) | `gemma3:4b` |
| System Prompt | Instructions for the AI | English, concise, contextual |
| Opacity | Window transparency | 90% |
| Font Size | UI text size in pixels | 12px |
| Transcription Interval | Seconds between Whisper processing | 10s (3-30s range) |

---

## Building for Production

```bash
# macOS
npm run dist:mac

# Windows
npm run dist:win
```

Output goes to the `release/` directory.

---

## Troubleshooting

### Red dot / "Ollama not detected"

- Make sure Ollama is installed and running
- Run `ollama serve` in a terminal
- Check the Ollama Base URL in Settings (default: `http://localhost:11434`)

### No system audio captured

- Go to **System Settings > Privacy & Security > Screen Recording**
- Enable **Ghost AI** (or the terminal app if running in dev mode)
- Restart the app after granting permission

### Microphone not working

- Go to **System Settings > Privacy & Security > Microphone**
- Enable **Ghost AI**

### "Cannot be opened" on first launch

- **System Settings > Privacy & Security** > scroll down > click **"Open Anyway"**
- Or: right-click the app > **Open** > **Open**

### Whisper model download fails

- Check your internet connection (needed only for the first download)
- The model is cached after the first successful download (~118MB)
- Try restarting the app

### `SetApplicationIsDaemon` warning in console

- This is a harmless Chromium subprocess issue on unsigned macOS dev builds
- It disappears in signed production builds and does not affect functionality

---

## Project Structure

```
ghost-ai/
  electron/
    main.ts            # Main process: window, tray, shortcuts, IPC, Whisper
    preload.ts         # Context bridge (ghostAPI)
  src/
    App.tsx            # Root component, view routing
    components/
      Overlay.tsx      # Main overlay UI, title bar, chat, quick actions
      ChatInput.tsx    # Message input field
      MessageBubble.tsx  # Chat message display
      AudioCapture.tsx   # Audio capture, transcription, source toggle
      Settings.tsx     # Settings panel
      HelpPanel.tsx    # Help & reference panel
    hooks/
      useGhostAI.ts    # Ollama integration, settings, chat state
      useWhisper.ts    # Whisper IPC bridge
    types.ts           # TypeScript interfaces
    styles/
      globals.css      # Tailwind + custom glass/animation styles
  vite.config.mts      # Vite + Electron plugin config
```

## Technical Details

- **Whisper runs in the main process** -- the renderer can't access `fs` which the transformers library needs internally.
- **`@huggingface/transformers` v4** with `onnx-community/whisper-tiny` (~118MB `decoder_model_merged.onnx`).
- **`net.fetch` override** -- Electron's Chromium network stack is used for model downloads because Node's undici fetch fails on HuggingFace's 302 redirect chain.
- **Externalized from Vite** -- `@huggingface/transformers` and `onnxruntime-node` are loaded at runtime via dynamic `import()` from `node_modules`.
- **Silence detection** (RMS threshold 0.002) and **hallucination filtering** prevent Whisper from generating false output on silence/noise.
- **Permission handler** only grants `media`, `microphone`, and `screen` permissions -- nothing else. Clipboard writes are routed through a native IPC channel (`clipboard-write`) instead of the web clipboard API.
- **Electron is pinned to 38.8.6** -- Electron 39+ breaks system-audio loopback on recent macOS (loopback track goes live-but-silent). Do **not** run `npm audit fix --force`; it will upgrade to 42 and silently break audio.

---

## Privacy

Ghost AI is designed with privacy as a core principle:

- All AI inference runs locally via Ollama
- Audio transcription runs locally via Whisper
- No external API calls (except HuggingFace CDN for initial model download)
- No telemetry, analytics, cookies, or tracking
- No accounts, no sign-up, no cloud sync
- Conversations are stored in memory only (lost on restart unless saved to file)

---

## License

MIT
