import { DEFAULT_SHORTCUTS, formatAccelerator, isMacPlatform, type Shortcuts } from '../lib/shortcuts'

interface HelpPanelProps {
  onBack: () => void
  shortcuts?: Shortcuts // configured global shortcuts (Settings)
  onRunSetup?: () => void // reopen the first-run setup
}

export function HelpPanel({ onBack, shortcuts = DEFAULT_SHORTCUTS, onRunSetup }: HelpPanelProps) {
  const isMac = isMacPlatform()
  const keys = (action: keyof Shortcuts) => formatAccelerator(shortcuts[action] ?? DEFAULT_SHORTCUTS[action], isMac)
  return (
    <div className="w-full h-full flex flex-col glass overflow-hidden animate-fade-in">
      {/* Header — pl clears the native macOS traffic-light buttons (top-left) */}
      <div className="toolbar">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors no-drag"
          >
            <svg className="w-4 h-4 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-body font-semibold text-ghost-text">Help</span>
        </div>
      </div>

      {/* Help Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 no-drag">
        {/* Keyboard Shortcuts */}
        <Section title="Keyboard Shortcuts">
          <div className="space-y-1.5 text-body text-ghost-text-muted">
            <ShortcutRow label="Show/Hide overlay" shortcut={keys('toggleOverlay')} />
            <ShortcutRow label="Capture screenshot & analyze" shortcut={keys('screenshot')} />
            <ShortcutRow label="Crop screen region & analyze" shortcut={keys('cropScreenshot')} />
            <ShortcutRow label="Focus text input" shortcut={keys('focusInput')} />
            <ShortcutRow label="Toggle compact mode" shortcut={keys('compactMode')} />
            <ShortcutRow label="Clear text input" shortcut="Esc" />
            <ShortcutRow label="Stop generating (while a reply streams)" shortcut="Esc" />
            <ShortcutRow label="Send message" shortcut="Enter" />
          </div>
        </Section>

        {/* Title Bar Buttons */}
        {onRunSetup && (
          <div className="flex items-center justify-between bg-ghost-fill rounded-lg px-3 py-2">
            <span className="text-callout text-ghost-text-muted">Check Ollama, permissions and the speech model again.</span>
            <button onClick={onRunSetup} className="ml-2 flex-shrink-0 text-callout text-ghost-accent hover:text-ghost-accent-hover">
              Run setup again
            </button>
          </div>
        )}

        <Section title="Title Bar Buttons">
          <div className="space-y-2 text-callout text-ghost-text-muted">
            <ButtonRow
              icon={<span className="block w-6 h-1 rounded-full bg-ghost-fill-strong overflow-hidden"><span className="block h-full w-3/5 bg-ghost-accent" /></span>}
              label="Context meter"
              description="How much of the model's context window the last request used. Amber past 70%, red past 90%; hover for the numbers and whether older chat was left out"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              }
              label="Documents"
              description="Add your CV, a job description, an agenda or notes (.pdf, .txt, .md). The most relevant excerpts go along with each request and the reply says which documents it used. Indexed on this machine; matching by meaning needs a local embedding model (ollama pull nomic-embed-text), otherwise keyword search is used"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              label="History"
              description="Saved sessions — transcript, chat and meeting notes — with text search, Export .md and Delete. Saving is off by default: turn on Save sessions there or in Settings > Privacy. A session ends when you clear the chat or the transcript. Kept on this machine only, encrypted (key in the macOS Keychain); screenshots are never saved"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" />
                </svg>
              }
              label="Compact mode"
              description={`Shrinks Ghost AI to a small card showing only the latest suggestion (${keys('compactMode')}). Clicks pass through the card to the app underneath; hover its top bar to drag or expand. Recording, Auto and Questions keep running`}
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              }
              label="Change preset"
              description="Switches the prompt preset (General, Technical interview, Sales call, Lecture/Class or your own). A preset sets the system prompt, the Suggest reply / Auto prompt and the chat quick actions"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              }
              label="Change model"
              description="Opens a quick menu to switch the active Ollama model on the fly"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
              label="Screenshot (Full)"
              description={`Captures the screen under the mouse pointer and sends it to Ollama to analyze visible content (${keys('screenshot')})`}
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3v4M3 7h4m10 0h4M17 3v4M7 17v4M3 17h4m10 0h4m-4-14v14H7V3" />
                </svg>
              }
              label="Screenshot (Crop)"
              description={`Opens a fullscreen overlay on the screen under the mouse pointer to select a region (${keys('cropScreenshot')}). Click and drag to crop, Esc to cancel. The region is cut at full Retina resolution and sent to Ollama for analysis`}
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
              }
              label="Save Conversation"
              description="Exports the full chat to a .txt file with an AI-generated filename"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              }
              label="Clear Chat"
              description="Deletes all messages from the current conversation"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
              label="Settings"
              description="Opens the settings panel (model, context window, reasoning, presets, appearance, Whisper model and language, transcription, shortcuts, privacy). Settings are saved on this machine and kept across restarts"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              label="Help"
              description="Opens this reference panel"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              }
              label="Minimize"
              description={`Hides the window. Use ${keys('toggleOverlay')} to bring it back`}
            />
          </div>
        </Section>

        {/* Audio Capture Buttons */}
        <Section title="Audio Buttons">
          <div className="space-y-2 text-callout text-ghost-text-muted">
            <ButtonRow
              icon={
                <div className="flex rounded-lg overflow-hidden border border-ghost-border">
                  <span className="px-1 py-0.5 text-footnote bg-ghost-accent/20 text-ghost-accent">Mic</span>
                  <span className="px-1 py-0.5 text-footnote bg-ghost-fill">System</span>
                  <span className="px-1 py-0.5 text-footnote bg-ghost-fill">Both</span>
                </div>
              }
              label="Audio Source"
              description="Mic = your microphone | System = audio from meetings/videos/calls | Both = mic + system on separate channels (when the mic picks up the speakers, the repeated text is dropped)"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-accent/20 text-ghost-accent">Speakers</span>}
              label="Speakers (diarization)"
              description="Separates who is talking. Your mic is labeled 'You'; the other side (system audio) is split by voice into Speaker A / B / C using a local model. Click a label to rename it (e.g. A → Maria); the name is used in suggestions, notes and saved files. First use downloads a small speaker model."
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              }
              label="Record / Stop"
              description="Starts or stops audio capture. Audio is transcribed locally by Whisper, using the model and language chosen in Settings (a model change made while recording applies after Stop). If macOS kills the stream (~20 min), it auto-reconnects"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-accent/20 text-ghost-accent">Questions</span>}
              label="Questions"
              description="While recording the other side (System or Both): as soon as they ask a question, a reply is suggested right away instead of waiting for the Auto timer"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-accent/20 text-ghost-accent">Auto</span>}
              label="Auto"
              description="When active, what was said since the last send is automatically sent to Ollama at the configured interval for reply suggestions (the rest of the conversation goes along as context)"
            />
            <ButtonRow
              icon={
                <div className="flex items-center gap-0.5">
                  <span className="px-1 py-0.5 rounded text-footnote bg-ghost-fill text-ghost-text-muted">-</span>
                  <span className="text-footnote text-ghost-text-muted">30s</span>
                  <span className="px-1 py-0.5 rounded text-footnote bg-ghost-fill text-ghost-text-muted">+</span>
                </div>
              }
              label="Auto Interval (10-120s)"
              description="Controls how often the transcription is sent to Ollama when Auto is active. Appears when Auto is on. Use - / + to adjust (steps of 5s)"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-accent/20 text-ghost-accent">Suggest reply</span>}
              label="Suggest reply"
              description="Asks Ollama to suggest a natural response to the most recent part of the conversation"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-purple-500/20 text-purple-400">Summarize</span>}
              label="Summarize"
              description="Sends the transcription to Ollama to generate a bullet-point summary of the key topics"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-blue-500/20 text-blue-400">Summary PT</span>}
              label="Summary PT"
              description="Sends the transcription to Ollama to generate a bullet-point summary of the key topics, each with a short explanation, in Brazilian Portuguese (pt-BR)"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-amber-500/20 text-amber-500">Notes</span>}
              label="Notes"
              description="Generates meeting notes in Markdown, in the language of the conversation: Summary, Key decisions, Action items (- [ ] task — owner, using the You/A/B/C speaker labels when Speakers is on) and Open questions. Also offered when you stop recording. Use Save .md on the reply to export them"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-success/20 text-ghost-success">Save</span>}
              label="Save"
              description="Saves the transcription to a .txt file with an AI-generated filename"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-fill-strong text-ghost-text-muted">Clear</span>}
              label="Clear"
              description="Clears the accumulated transcription"
            />
          </div>
        </Section>

        {/* Chat */}
        <Section title="Chat">
          <div className="space-y-2 text-callout text-ghost-text-muted">
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-error/80 text-white">■</span>}
              label="Stop"
              description="Replaces Send while a reply is generating. Stops it and keeps what was written so far (Esc does the same)"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-fill-strong text-ghost-text-muted">Queue</span>}
              label="Queued requests"
              description="Screenshots, Notes, Summarize and quick actions requested while a reply is generating wait their turn (up to 3) instead of being dropped"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-fill-strong text-ghost-text-muted">Reasoning</span>}
              label="Reasoning"
              description="Thinking models (e.g. qwen3) reason before answering; the reasoning is shown above the reply and collapses when the answer starts. Reasoning takes room in the context window; if it fills up before an answer, Ghost AI answers without reasoning and says so. Turn it off in Settings for faster replies"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-fill-strong text-ghost-text-muted">Copy</span>}
              label="Formatted replies"
              description="Replies are rendered as Markdown with highlighted code; hover a code block to copy it. Links and images are shown as text only, nothing is loaded from the internet"
            />
          </div>
        </Section>

        {/* Quick Actions */}
        <Section title="Quick Actions (Chat)">
          <div className="space-y-2 text-callout text-ghost-text-muted">
            <p className="opacity-70 leading-relaxed">
              Quick actions come from the active preset and can be edited in Settings. The General preset has:
            </p>
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-accent/20 text-ghost-accent">Summarize</span>}
              label="Summarize"
              description="Summarizes the entire conversation into key points"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-accent/20 text-ghost-accent">Suggest reply</span>}
              label="Suggest reply"
              description="Suggests what you should respond based on context"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-footnote bg-ghost-accent/20 text-ghost-accent">Next steps</span>}
              label="Next steps"
              description="Suggests the logical next steps"
            />
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-body font-medium text-ghost-text mb-2">{title}</h3>
      {children}
    </div>
  )
}

function ShortcutRow({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-body text-ghost-text-muted">{label}</span>
      <kbd className="bg-ghost-fill-strong px-1.5 py-0.5 rounded-full text-subhead font-mono text-ghost-text">
        {shortcut}
      </kbd>
    </div>
  )
}

function ButtonRow({ icon, label, description }: { icon: React.ReactNode; label: string; description: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div>
        <span className="text-ghost-text font-medium">{label}</span>
        <p className="text-ghost-text-muted opacity-70 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}
