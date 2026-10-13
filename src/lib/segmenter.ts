// Energy-based voice-activity segmenter.
//
// Audio is fed in arbitrary-sized blocks; it is analysed in 20 ms frames. A frame
// is speech when its RMS is well above an adaptive noise floor. A segment opens
// on speech (with a short pre-roll so word onsets aren't clipped) and closes
// after ~700 ms of silence — a natural pause — or when it reaches the maximum
// length, so Whisper gets whole phrases instead of fixed slices cut mid-word.
// When forced to cut a long run of speech, it cuts at the quietest frame of the
// last second and carries the rest into the next segment.

export interface SegmenterOptions {
  sampleRate: number
  maxSegmentSeconds: number
  pauseMs?: number // silence that closes a segment
  minSpeechMs?: number // segments with less speech than this are dropped (clicks, coughs)
  preRollMs?: number // audio kept from before speech onset
  frameMs?: number
}

const MIN_RMS = 0.002 // absolute floor: matches the old silence-skip threshold
const START_FACTOR = 3 // speech starts at noise floor × this
const CONTINUE_FACTOR = 2 // ...and continues while above floor × this
// Per-frame noise-floor adaptation. While a frame counts as speech the floor
// creeps up slowly (so a steady hum is eventually treated as noise, ~15 s);
// in non-speech frames it follows the level quickly. Pauses between words pull
// it back down, so normal speech never becomes "noise".
const FLOOR_RISE = 0.001
const FLOOR_FALL = 0.05 // per-frame adaptation in silence

export class SpeechSegmenter {
  private readonly sampleRate: number
  private readonly frameSize: number
  private readonly frameMs: number
  private readonly pauseFrames: number
  private readonly minSpeechFrames: number
  private readonly preRollFrames: number
  private maxFrames: number

  // Starts at zero rather than the first frame's level: a recording that begins
  // mid-sentence would otherwise take that speech as the noise floor.
  private noiseFloor = 0
  private pending = new Float32Array(0) // samples not yet forming a whole frame
  private preRoll: Float32Array[] = []
  private frames: Float32Array[] = [] // current segment
  private frameRms: number[] = []
  private speechFrames = 0
  private silentRun = 0
  private inSegment = false

  constructor(opts: SegmenterOptions) {
    this.sampleRate = opts.sampleRate
    this.frameMs = opts.frameMs ?? 20
    this.frameSize = Math.max(1, Math.round(this.sampleRate * this.frameMs / 1000))
    this.pauseFrames = Math.ceil((opts.pauseMs ?? 700) / this.frameMs)
    this.minSpeechFrames = Math.ceil((opts.minSpeechMs ?? 250) / this.frameMs)
    this.preRollFrames = Math.ceil((opts.preRollMs ?? 200) / this.frameMs)
    this.maxFrames = this.framesFor(opts.maxSegmentSeconds)
  }

  private framesFor(seconds: number): number {
    return Math.max(this.pauseFrames + 1, Math.round(seconds * 1000 / this.frameMs))
  }

  // Applies from the next frame on (Settings → Transcription interval is live).
  setMaxSegmentSeconds(seconds: number) {
    this.maxFrames = this.framesFor(seconds)
  }

  get isSpeaking(): boolean {
    return this.inSegment
  }

  /** Feed audio; returns any segments that closed during this block. */
  push(samples: Float32Array): Float32Array[] {
    const out: Float32Array[] = []
    let data = samples
    if (this.pending.length > 0) {
      data = new Float32Array(this.pending.length + samples.length)
      data.set(this.pending)
      data.set(samples, this.pending.length)
    }
    let i = 0
    for (; i + this.frameSize <= data.length; i += this.frameSize) {
      const seg = this.processFrame(data.slice(i, i + this.frameSize))
      if (seg) out.push(seg)
    }
    this.pending = data.slice(i)
    return out
  }

  /** Close the open segment (e.g. on Stop). Returns null if it held too little speech. */
  flush(): Float32Array | null {
    if (this.pending.length > 0 && this.inSegment) {
      this.frames.push(this.pending)
      this.frameRms.push(0)
    }
    this.pending = new Float32Array(0)
    if (!this.inSegment) return null
    return this.close(this.frames.length)
  }

  private processFrame(frame: Float32Array): Float32Array | null {
    let sum = 0
    for (let k = 0; k < frame.length; k++) sum += frame[k] * frame[k]
    const rms = Math.sqrt(sum / frame.length)

    const factor = this.inSegment ? CONTINUE_FACTOR : START_FACTOR
    const isSpeech = rms > Math.max(MIN_RMS, this.noiseFloor * factor)
    const rate = isSpeech ? FLOOR_RISE : FLOOR_FALL
    this.noiseFloor += (rms - this.noiseFloor) * rate

    if (!this.inSegment) {
      if (!isSpeech) {
        this.preRoll.push(frame)
        if (this.preRoll.length > this.preRollFrames) this.preRoll.shift()
        return null
      }
      this.inSegment = true
      this.frames = this.preRoll
      this.frameRms = this.preRoll.map(() => 0)
      this.preRoll = []
      this.speechFrames = 0
      this.silentRun = 0
    }

    this.frames.push(frame)
    this.frameRms.push(rms)
    if (isSpeech) {
      this.speechFrames++
      this.silentRun = 0
    } else {
      this.silentRun++
    }

    if (this.silentRun >= this.pauseFrames) {
      // Natural pause: keep a little trailing silence, drop the rest.
      const keep = this.frames.length - this.silentRun + Math.min(this.silentRun, this.preRollFrames)
      return this.close(keep)
    }
    if (this.frames.length >= this.maxFrames) {
      return this.forceCut()
    }
    return null
  }

  // Max length reached mid-speech: cut at the quietest frame in the last second.
  private forceCut(): Float32Array | null {
    const window = Math.min(this.frames.length - 1, Math.round(1000 / this.frameMs))
    let cut = this.frames.length
    let quietest = Infinity
    for (let k = this.frames.length - window; k < this.frames.length; k++) {
      if (this.frameRms[k] < quietest) { quietest = this.frameRms[k]; cut = k + 1 }
    }
    const carryFrames = this.frames.slice(cut)
    const carryRms = this.frameRms.slice(cut)
    const seg = this.close(cut, false)
    // Speech continues: the carried frames start the next segment.
    this.inSegment = true
    this.frames = carryFrames
    this.frameRms = carryRms
    this.speechFrames = carryRms.filter(r => r > Math.max(MIN_RMS, this.noiseFloor * CONTINUE_FACTOR)).length
    this.silentRun = 0
    return seg
  }

  private close(keepFrames: number, resetState = true): Float32Array | null {
    const kept = this.frames.slice(0, keepFrames)
    const enoughSpeech = this.speechFrames >= this.minSpeechFrames
    if (resetState) {
      this.inSegment = false
      this.frames = []
      this.frameRms = []
      this.speechFrames = 0
      this.silentRun = 0
      this.preRoll = []
    }
    if (!enoughSpeech || kept.length === 0) return null
    const total = kept.reduce((n, f) => n + f.length, 0)
    const out = new Float32Array(total)
    let off = 0
    for (const f of kept) { out.set(f, off); off += f.length }
    return out
  }
}
