import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioCapture } from '../components/AudioCapture'

// End-to-end through the capture graph: system audio (and mic in Both mode)
// on a 16 kHz ScriptProcessor graph, Whisper/embeddings mocked per segment.

const settings = {
  selectedModel: 'gemma4:latest',
  ollamaBaseUrl: 'http://localhost:11434',
  transcriptionInterval: 10,
  speakerThreshold: 0.85,
}

const tone = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin(i / 5))
// One spoken phrase: ~1s of speech closed by ~1s of silence
const phrase = (send: (d: Float32Array) => void) => {
  for (let i = 0; i < 4; i++) send(tone(4096))
  for (let i = 0; i < 4; i++) send(new Float32Array(4096))
}

let processors: any[] = []
let BaseContext: any

beforeEach(() => {
  processors = []
  BaseContext = (globalThis as any).AudioContext
  class Ctx16k extends BaseContext {
    sampleRate = 16000
    createScriptProcessor() {
      const p = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as any }
      processors.push(p)
      return p
    }
  }
  ;(globalThis as any).AudioContext = Ctx16k

  // System audio needs a stream with an audio track
  const track = { onended: null, stop: vi.fn() }
  const systemStream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] }
  vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(systemStream as any)

  window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
  window.ghostAPI.embedLoad = vi.fn().mockResolvedValue({ status: 'ready' })
})

afterEach(() => {
  ;(globalThis as any).AudioContext = BaseContext
})

const feeder = (n: number) => (data: Float32Array) =>
  processors[n].onaudioprocess({ inputBuffer: { getChannelData: () => data } })

async function startRecording(source: 'System' | 'Both', { speakers = true } = {}) {
  fireEvent.click(await screen.findByText(source))
  if (speakers) {
    fireEvent.click(screen.getByText('Speakers'))
    await waitFor(() => expect(window.ghostAPI.embedLoad).toHaveBeenCalled())
  }
  fireEvent.click(screen.getByTitle(/Transcribe/))
  await waitFor(() => expect(processors).toHaveLength(source === 'Both' ? 2 : 1))
}

describe('AudioCapture speakers, questions and echo', () => {
  it('should label system voices A and B and let the user rename them', async () => {
    window.ghostAPI.whisperTranscribe = vi.fn()
      .mockResolvedValueOnce({ success: true, text: 'Welcome everyone to the meeting.' })
      .mockResolvedValueOnce({ success: true, text: 'Thanks, glad to be here.' })
    window.ghostAPI.embedSpeaker = vi.fn()
      .mockResolvedValueOnce({ success: true, embedding: [1, 0, 0] })
      .mockResolvedValueOnce({ success: true, embedding: [0, 1, 0] })
    const onTranscriptChange = vi.fn()
    render(<AudioCapture onTranscription={vi.fn()} onSummarize={vi.fn()} onSummarizePT={vi.fn()} onTranscriptChange={onTranscriptChange} isConnected settings={settings} />)
    await startRecording('System')
    const system = feeder(0)
    phrase(system)
    await screen.findByText('Welcome everyone to the meeting.')
    phrase(system)
    await screen.findByText('Thanks, glad to be here.')
    expect(onTranscriptChange).toHaveBeenLastCalledWith('A: Welcome everyone to the meeting.\nB: Thanks, glad to be here.', ['A', 'B'])

    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    const input = screen.getByLabelText('Name for speaker A')
    fireEvent.change(input, { target: { value: 'Maria' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Maria' })).toBeInTheDocument()
    expect(onTranscriptChange).toHaveBeenLastCalledWith('Maria: Welcome everyone to the meeting.\nB: Thanks, glad to be here.', ['Maria', 'B'])

    // An empty name restores the label
    fireEvent.click(screen.getByRole('button', { name: 'Maria' }))
    const again = screen.getByLabelText('Name for speaker A')
    fireEvent.change(again, { target: { value: '' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument()
  })

  it('should cancel a rename with Esc', async () => {
    window.ghostAPI.whisperTranscribe = vi.fn().mockResolvedValue({ success: true, text: 'Hello from the call.' })
    window.ghostAPI.embedSpeaker = vi.fn().mockResolvedValue({ success: true, embedding: [1, 0] })
    render(<AudioCapture onTranscription={vi.fn()} onSummarize={vi.fn()} onSummarizePT={vi.fn()} isConnected settings={settings} />)
    await startRecording('System')
    phrase(feeder(0))
    await screen.findByText('Hello from the call.')
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    const input = screen.getByLabelText('Name for speaker A')
    fireEvent.change(input, { target: { value: 'Bob' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument()
  })

  it('should suggest a reply as soon as the other side asks a question', async () => {
    window.ghostAPI.whisperTranscribe = vi.fn()
      .mockResolvedValueOnce({ success: true, text: 'Our budget is about ten thousand.' })
      .mockResolvedValueOnce({ success: true, text: 'Can you deliver by Friday?' })
    window.ghostAPI.embedSpeaker = vi.fn().mockResolvedValue({ success: true, embedding: [1, 0] })
    const onTranscription = vi.fn()
    render(<AudioCapture onTranscription={onTranscription} onSummarize={vi.fn()} onSummarizePT={vi.fn()} isConnected settings={settings} />)
    await startRecording('System')
    fireEvent.click(screen.getByText('Questions'))

    phrase(feeder(0))
    await screen.findByText('Our budget is about ten thousand.')
    expect(onTranscription).not.toHaveBeenCalled()

    phrase(feeder(0))
    await waitFor(() => expect(onTranscription).toHaveBeenCalledWith('A: Can you deliver by Friday?'))
    expect(onTranscription).toHaveBeenCalledTimes(1)
  })

  it('should not answer questions when the mode is off', async () => {
    window.ghostAPI.whisperTranscribe = vi.fn().mockResolvedValue({ success: true, text: 'Can you deliver by Friday?' })
    const onTranscription = vi.fn()
    render(<AudioCapture onTranscription={onTranscription} onSummarize={vi.fn()} onSummarizePT={vi.fn()} isConnected settings={settings} />)
    await startRecording('System', { speakers: false })
    phrase(feeder(0))
    await screen.findByText('Can you deliver by Friday?')
    expect(onTranscription).not.toHaveBeenCalled()
  })

  it('should drop mic text that echoes the speakers in Both mode', async () => {
    // Segments are transcribed in the order they close: system first, then the mic echo, then real mic speech
    window.ghostAPI.whisperTranscribe = vi.fn()
      .mockResolvedValueOnce({ success: true, text: 'We should ship the release on Friday.' })
      .mockResolvedValueOnce({ success: true, text: 'we should ship the release on friday' })
      .mockResolvedValueOnce({ success: true, text: 'Sounds good to me.' })
    window.ghostAPI.embedSpeaker = vi.fn().mockResolvedValue({ success: true, embedding: [1, 0] })
    const onTranscriptChange = vi.fn()
    render(<AudioCapture onTranscription={vi.fn()} onSummarize={vi.fn()} onSummarizePT={vi.fn()} onTranscriptChange={onTranscriptChange} isConnected settings={settings} />)
    await startRecording('Both')
    const mic = feeder(0)
    const system = feeder(1)

    phrase(system)
    await screen.findByText('We should ship the release on Friday.')
    phrase(mic) // echo
    phrase(mic) // the user's own reply
    await screen.findByText('Sounds good to me.')
    expect(onTranscriptChange).toHaveBeenLastCalledWith('A: We should ship the release on Friday.\nYou: Sounds good to me.', ['A', 'You'])
    expect(screen.queryByText('we should ship the release on friday')).toBeNull()
  })

  it('should retract a mic echo that was transcribed before the system audio', async () => {
    window.ghostAPI.whisperTranscribe = vi.fn()
      .mockResolvedValueOnce({ success: true, text: 'let us review the roadmap now' })
      .mockResolvedValueOnce({ success: true, text: "Let's review the roadmap now." })
    window.ghostAPI.embedSpeaker = vi.fn().mockResolvedValue({ success: true, embedding: [1, 0] })
    const onTranscriptChange = vi.fn()
    render(<AudioCapture onTranscription={vi.fn()} onSummarize={vi.fn()} onSummarizePT={vi.fn()} onTranscriptChange={onTranscriptChange} isConnected settings={settings} />)
    await startRecording('Both')
    phrase(feeder(0)) // mic hears it first
    await screen.findByText('let us review the roadmap now')
    phrase(feeder(1)) // then the system channel
    await screen.findByText("Let's review the roadmap now.")
    expect(screen.queryByText('let us review the roadmap now')).toBeNull()
    expect(onTranscriptChange).toHaveBeenLastCalledWith("A: Let's review the roadmap now.", ['A'])
  })

  it('should keep both channels when they say different things', async () => {
    window.ghostAPI.whisperTranscribe = vi.fn()
      .mockResolvedValueOnce({ success: true, text: 'What is your timeline for this?' })
      .mockResolvedValueOnce({ success: true, text: 'We plan to launch in March.' })
    window.ghostAPI.embedSpeaker = vi.fn().mockResolvedValue({ success: true, embedding: [1, 0] })
    render(<AudioCapture onTranscription={vi.fn()} onSummarize={vi.fn()} onSummarizePT={vi.fn()} isConnected settings={settings} />)
    await startRecording('Both')
    phrase(feeder(1))
    await screen.findByText('What is your timeline for this?')
    phrase(feeder(0))
    await screen.findByText('We plan to launch in March.')
  })
})
