interface HelpPanelProps {
  onBack: () => void
}

export function HelpPanel({ onBack }: HelpPanelProps) {
  return (
    <div className="w-full h-full flex flex-col glass rounded-2xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ghost-border drag-region">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-white/10 transition-colors no-drag"
          >
            <svg className="w-4 h-4 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-ghost-text">Help</span>
        </div>
      </div>

      {/* Help Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 no-drag">
        {/* Keyboard Shortcuts */}
        <Section title="Keyboard Shortcuts">
          <div className="space-y-1.5 text-xs text-ghost-text-muted">
            <ShortcutRow label="Show/Hide overlay" shortcut="Cmd+Shift+G" />
            <ShortcutRow label="Capture screenshot & analyze" shortcut="Cmd+Shift+S" />
            <ShortcutRow label="Crop screen region & analyze" shortcut="Cmd+Shift+X" />
            <ShortcutRow label="Focus text input" shortcut="Cmd+Shift+A" />
            <ShortcutRow label="Clear text input" shortcut="Esc" />
            <ShortcutRow label="Send message" shortcut="Enter" />
          </div>
        </Section>

        {/* Title Bar Buttons */}
        <Section title="Title Bar Buttons">
          <div className="space-y-2 text-[10px] text-ghost-text-muted">
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
              description="Captures the full screen and sends it to Ollama to analyze visible content (Cmd+Shift+S)"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3v4M3 7h4m10 0h4M17 3v4M7 17v4M3 17h4m10 0h4m-4-14v14H7V3" />
                </svg>
              }
              label="Screenshot (Crop)"
              description="Opens a fullscreen overlay to select a region (Cmd+Shift+X). Click and drag to crop, Esc to cancel. The cropped region is sent to Ollama for analysis"
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
              description="Opens the settings panel (model, prompt, opacity, transcription interval)"
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
              description="Hides the window. Use Cmd+Shift+G to bring it back"
            />
          </div>
        </Section>

        {/* Audio Capture Buttons */}
        <Section title="Audio Buttons">
          <div className="space-y-2 text-[10px] text-ghost-text-muted">
            <ButtonRow
              icon={
                <div className="flex rounded-lg overflow-hidden border border-ghost-border">
                  <span className="px-1 py-0.5 text-[7px] bg-ghost-accent/20 text-ghost-accent">Mic</span>
                  <span className="px-1 py-0.5 text-[7px] bg-white/5">System</span>
                  <span className="px-1 py-0.5 text-[7px] bg-white/5">Both</span>
                </div>
              }
              label="Audio Source"
              description="Mic = your microphone | System = audio from meetings/videos/calls | Both = mic + system mixed together"
            />
            <ButtonRow
              icon={
                <svg className="w-3.5 h-3.5 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              }
              label="Record / Stop"
              description="Starts or stops audio capture. Audio is transcribed locally by Whisper. If macOS kills the stream (~20 min), it auto-reconnects"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded text-[8px] bg-ghost-accent/20 text-ghost-accent">Auto</span>}
              label="Auto"
              description="When active, the accumulated transcription is automatically sent to Ollama at the configured interval for reply suggestions"
            />
            <ButtonRow
              icon={
                <div className="flex items-center gap-0.5">
                  <span className="px-1 py-0.5 rounded text-[8px] bg-white/5 text-ghost-text-muted">-</span>
                  <span className="text-[8px] text-ghost-text-muted">30s</span>
                  <span className="px-1 py-0.5 rounded text-[8px] bg-white/5 text-ghost-text-muted">+</span>
                </div>
              }
              label="Auto Interval (10-120s)"
              description="Controls how often the transcription is sent to Ollama when Auto is active. Appears when Auto is on. Use - / + to adjust (steps of 5s)"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded text-[8px] bg-ghost-accent/20 text-ghost-accent">Suggest reply</span>}
              label="Suggest reply"
              description="Sends the transcription to Ollama to suggest a natural response for the conversation"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded text-[8px] bg-purple-500/20 text-purple-400">Summarize</span>}
              label="Summarize"
              description="Sends the transcription to Ollama to generate a bullet-point summary of the key topics"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded text-[8px] bg-blue-500/20 text-blue-400">Translate PT</span>}
              label="Translate PT"
              description="Sends the transcription to Ollama to translate it into Brazilian Portuguese in real time"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded text-[8px] bg-ghost-success/20 text-ghost-success">Save</span>}
              label="Save"
              description="Saves the transcription to a .txt file with an AI-generated filename"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded text-[8px] bg-white/10 text-ghost-text-muted">Clear</span>}
              label="Clear"
              description="Clears the accumulated transcription"
            />
          </div>
        </Section>

        {/* Quick Actions */}
        <Section title="Quick Actions (Chat)">
          <div className="space-y-2 text-[10px] text-ghost-text-muted">
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-[8px] bg-ghost-accent/20 text-ghost-accent">Summarize</span>}
              label="Summarize"
              description="Summarizes the entire conversation into key points"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-[8px] bg-ghost-accent/20 text-ghost-accent">Suggest reply</span>}
              label="Suggest reply"
              description="Suggests what you should respond based on context"
            />
            <ButtonRow
              icon={<span className="px-1.5 py-0.5 rounded-full text-[8px] bg-ghost-accent/20 text-ghost-accent">Next steps</span>}
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
      <h3 className="text-xs font-medium text-ghost-text mb-2">{title}</h3>
      {children}
    </div>
  )
}

function ShortcutRow({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ghost-text-muted">{label}</span>
      <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-mono text-ghost-text">
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
