// Online speaker clustering for system audio (Speakers mode). Pure.

// Default cosine-similarity threshold for grouping system-audio chunks into the
// same speaker. Embeddings are L2-normalized, so dot product == cosine similarity.
// wavlm-base-plus-sv was tuned around 0.86 (same speaker scores above, different
// speakers below). Lower → speakers merge into one; higher → one person splits
// into several. User-tunable via Settings (settings.speakerThreshold).
export const DEFAULT_SPEAKER_THRESHOLD = 0.85

function dot(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/**
 * Assigns A, B, C... to voice embeddings: each embedding joins the most
 * similar known speaker if it is at least `threshold` similar (the centroid is
 * updated as a running mean, re-normalized), otherwise it starts a new one.
 * No embedding (model not ready / failed) → 'Other'.
 */
export class SpeakerClusterer {
  private centroids: { label: string; centroid: number[]; count: number }[] = []

  assign(embedding: number[] | null, threshold = DEFAULT_SPEAKER_THRESHOLD): string {
    if (!embedding) return 'Other'
    let best = -1
    let bestSim = -2
    for (let i = 0; i < this.centroids.length; i++) {
      const sim = dot(embedding, this.centroids[i].centroid)
      if (sim > bestSim) { bestSim = sim; best = i }
    }
    if (best >= 0 && bestSim >= threshold) {
      const c = this.centroids[best]
      const n = c.count
      const merged = c.centroid.map((v, j) => (v * n + embedding[j]) / (n + 1))
      let norm = 0
      for (const v of merged) norm += v * v
      norm = Math.sqrt(norm) || 1
      c.centroid = merged.map(v => v / norm)
      c.count = n + 1
      return c.label
    }
    const label = String.fromCharCode(65 + this.centroids.length) // A, B, C, ...
    this.centroids.push({ label, centroid: embedding.slice(), count: 1 })
    return label
  }

  get speakerCount(): number {
    return this.centroids.length
  }

  reset() {
    this.centroids = []
  }
}
