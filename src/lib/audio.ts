// Audio-capture building blocks used by useAudioGraph / useTranscriptionQueue.
// No React here; the Web Audio parts need a browser (or the jsdom stubs).

// Capture processor run on the audio rendering thread. Batches 128-sample
// render quanta into 2048-sample blocks before posting them to the main thread.
const CAPTURE_WORKLET_SOURCE = `
class GhostCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer])
          this.buf = new Float32Array(2048)
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('ghost-capture', GhostCaptureProcessor)
`

// Load the capture worklet into this context. Returns false when AudioWorklet
// isn't available (or fails to load), in which case ScriptProcessor is used.
export async function loadCaptureWorklet(ctx: AudioContext): Promise<boolean> {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
    return true
  } catch (err) {
    console.warn('[AudioCapture] AudioWorklet failed to load, using ScriptProcessor:', err)
    return false
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function createCaptureNode(ctx: AudioContext, useWorklet: boolean, onData: (samples: Float32Array) => void): AudioNode {
  if (useWorklet) {
    const node = new AudioWorkletNode(ctx, 'ghost-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit', // downmix stereo loopback to mono
    })
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onData(e.data)
    return node
  }
  // Fallback (and jsdom tests): deprecated main-thread ScriptProcessor
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (e) => onData(new Float32Array(e.inputBuffer.getChannelData(0)))
  return processor
}

export async function resampleTo16kHz(audioData: Float32Array, fromSampleRate: number): Promise<Float32Array> {
  if (fromSampleRate === 16000) return audioData
  const numOutputSamples = Math.round(audioData.length * 16000 / fromSampleRate)
  const offlineCtx = new OfflineAudioContext(1, numOutputSamples, 16000)
  const buffer = offlineCtx.createBuffer(1, audioData.length, fromSampleRate)
  buffer.copyToChannel(new Float32Array(audioData) as unknown as Float32Array<ArrayBuffer>, 0)
  const source = offlineCtx.createBufferSource()
  source.buffer = buffer
  source.connect(offlineCtx.destination)
  source.start()
  const rendered = await offlineCtx.startRendering()
  return new Float32Array(rendered.getChannelData(0))
}

// RMS below this is treated as silence and never sent to Whisper
export function hasAudioEnergy(audio: Float32Array, threshold = 0.002): boolean {
  let sum = 0
  for (let i = 0; i < audio.length; i++) {
    sum += audio[i] * audio[i]
  }
  const rms = Math.sqrt(sum / audio.length)
  return rms > threshold
}

// Known Whisper hallucination patterns when audio is silence/noise
const HALLUCINATION_PATTERNS = [
  /^you\.?$/i,
  /^the\.?$/i,
  /^thank you\.?$/i,
  /^thanks for watching\.?$/i,
  /^bye\.?$/i,
  /^okay\.?$/i,
  /^uh\.?$/i,
  /^um\.?$/i,
  /^\.+$/,
  /^\s*$/,
]

export function isHallucination(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length < 3) return true
  return HALLUCINATION_PATTERNS.some(p => p.test(trimmed))
}
