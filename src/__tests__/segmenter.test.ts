import { describe, it, expect } from 'vitest'
import { SpeechSegmenter } from '../lib/segmenter'

const RATE = 16000

// Deterministic "speech": a tone at the given amplitude
function tone(ms: number, amplitude = 0.1): Float32Array {
  const n = Math.round(RATE * ms / 1000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(2 * Math.PI * 220 * i / RATE)
  return out
}

function silence(ms: number, amplitude = 0): Float32Array {
  const n = Math.round(RATE * ms / 1000)
  const out = new Float32Array(n)
  // Low-level deterministic noise
  for (let i = 0; i < n; i++) out[i] = amplitude * ((i * 7919) % 13 - 6) / 6
  return out
}

// Feed audio in render-sized blocks like the worklet does
function feed(seg: SpeechSegmenter, audio: Float32Array, block = 2048): Float32Array[] {
  const out: Float32Array[] = []
  for (let i = 0; i < audio.length; i += block) out.push(...seg.push(audio.subarray(i, i + block)))
  return out
}

const seconds = (a: Float32Array) => a.length / RATE

describe('SpeechSegmenter', () => {
  it('should emit nothing for silence', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10 })
    expect(feed(seg, silence(3000))).toEqual([])
    expect(seg.flush()).toBeNull()
  })

  it('should close a segment after a ~700ms pause', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10 })
    feed(seg, silence(500))
    expect(feed(seg, tone(1500))).toEqual([])
    expect(seg.isSpeaking).toBe(true)
    // 500 ms of silence is not yet a pause
    expect(feed(seg, silence(500))).toEqual([])
    const out = feed(seg, silence(400))
    expect(out).toHaveLength(1)
    // ~1.5 s of speech plus a little pre-roll / trailing silence
    expect(seconds(out[0])).toBeGreaterThan(1.4)
    expect(seconds(out[0])).toBeLessThan(2.1)
    expect(seg.isSpeaking).toBe(false)
  })

  it('should split two phrases separated by a pause', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10 })
    const out = [
      ...feed(seg, silence(300)),
      ...feed(seg, tone(1000)),
      ...feed(seg, silence(1000)),
      ...feed(seg, tone(800)),
      ...feed(seg, silence(1000)),
    ]
    expect(out).toHaveLength(2)
  })

  it('should not split on short gaps between words', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10 })
    const out = [
      ...feed(seg, tone(600)),
      ...feed(seg, silence(250)),
      ...feed(seg, tone(600)),
      ...feed(seg, silence(250)),
      ...feed(seg, tone(600)),
      ...feed(seg, silence(1000)),
    ]
    expect(out).toHaveLength(1)
  })

  it('should force a cut at maxSegmentSeconds during continuous speech', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 3 })
    const out = feed(seg, tone(7000))
    expect(out.length).toBeGreaterThanOrEqual(2)
    for (const s of out) expect(seconds(s)).toBeLessThanOrEqual(3.01)
    // Nothing is lost: what's still open comes out on flush
    const rest = seg.flush()
    const total = out.reduce((n, s) => n + s.length, 0) + (rest?.length ?? 0)
    expect(total / RATE).toBeCloseTo(7, 1)
  })

  it('should cut at the quietest point near the limit', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 3 })
    // A soft dip (still speech-level) 2.6 s in, then loud again
    const audio = new Float32Array([...tone(2600, 0.2), ...tone(100, 0.05), ...tone(2000, 0.2)])
    const out = feed(seg, audio)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(seconds(out[0])).toBeGreaterThan(2.55)
    expect(seconds(out[0])).toBeLessThan(2.75)
  })

  it('should apply a new maxSegmentSeconds live', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 30 })
    expect(feed(seg, tone(3000))).toEqual([])
    seg.setMaxSegmentSeconds(4)
    const out = feed(seg, tone(2000))
    expect(out).toHaveLength(1)
    expect(seconds(out[0])).toBeLessThanOrEqual(4.01)
  })

  it('should drop blips shorter than the minimum speech length', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10 })
    const out = [...feed(seg, silence(500)), ...feed(seg, tone(60)), ...feed(seg, silence(1000))]
    expect(out).toEqual([])
  })

  it('should adapt to steady background noise', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10 })
    // A constant hum well above the absolute floor is first taken for speech,
    // then becomes the noise floor
    const hum = (ms: number) => tone(ms, 0.01)
    feed(seg, hum(30000))
    expect(feed(seg, hum(5000))).toEqual([])
    expect(seg.isSpeaking).toBe(false)
    // Speech on top of the hum is still detected and closes on the pause
    const out = [...feed(seg, tone(1000, 0.2)), ...feed(seg, hum(1000))]
    expect(out).toHaveLength(1)
  })

  it('should return the open segment on flush', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10 })
    feed(seg, tone(1000))
    const out = seg.flush()
    expect(out).not.toBeNull()
    expect(seconds(out!)).toBeCloseTo(1, 1)
    expect(seg.flush()).toBeNull()
  })

  it('should keep a short pre-roll before speech onset', () => {
    const seg = new SpeechSegmenter({ sampleRate: RATE, maxSegmentSeconds: 10, preRollMs: 200 })
    feed(seg, silence(1000))
    feed(seg, tone(1000))
    const out = seg.flush()!
    expect(seconds(out)).toBeGreaterThan(1.15)
    expect(seconds(out)).toBeLessThan(1.25)
  })
})
