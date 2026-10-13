import { describe, it, expect } from 'vitest'
import {
  buildMeetingNotesRequest,
  detectSpeakers,
  meetingNotesInstructions,
  notesLanguage,
  normalizeNotesMarkdown,
  NOTES_REQUEST,
  NOTES_SECTIONS,
  notesDocument,
} from '../lib/notes'
import { estimateTokens, promptBudget } from '../lib/context'

describe('detectSpeakers', () => {
  it('should find diarization labels at the start of lines', () => {
    const t = 'A: hi\nYou: hello\nB: so, the plan\nA: yes\nOther: noise'
    expect(detectSpeakers(t)).toEqual(['You', 'A', 'B', 'Other'])
  })

  it('should return nothing for an unlabeled transcript', () => {
    expect(detectSpeakers('we talked about the budget. Note: A: not at line start')).toEqual([])
  })
})

describe('meetingNotesInstructions', () => {
  it('should ask for every section and the action-item format', () => {
    const text = meetingNotesInstructions([])
    for (const section of NOTES_SECTIONS) expect(text).toContain(`## ${section}`)
    expect(text).toContain('- [ ] task — owner')
    expect(text).toContain('Unassigned')
  })

  it('should assign owners by speaker label when diarization is on', () => {
    const text = meetingNotesInstructions(['You', 'A', 'B'])
    expect(text).toContain('speaker label')
    expect(text).toContain('You, A, B')
  })
})

describe('notes language', () => {
  it('should follow the transcription language chosen in Settings', () => {
    expect(notesLanguage('onnx-community/whisper-base', 'portuguese')).toBe('Portuguese')
    expect(notesLanguage('onnx-community/whisper-small', 'spanish')).toBe('Spanish')
  })

  it('should be English for English-only models', () => {
    expect(notesLanguage('onnx-community/whisper-base.en', 'portuguese')).toBe('English')
  })

  it('should leave it to the transcript on auto-detect', () => {
    expect(notesLanguage('onnx-community/whisper-base', 'auto')).toBeNull()
  })

  it('should ask for the chosen language and keep the headings', () => {
    const text = meetingNotesInstructions([], 'Portuguese')
    expect(text).toContain('Write the notes in Portuguese, the language of the conversation.')
    expect(text).toContain('keep the four section headings exactly as written above, in English (## Summary, ## Key decisions, ## Action items, ## Open questions)')
    expect(text).not.toContain('Write in English')
  })

  it('should ask for the transcript language on auto-detect', () => {
    expect(meetingNotesInstructions([], null)).toContain('same language as the transcript')
    expect(buildMeetingNotesRequest('A: oi', 8192).systemPrompt).toContain('same language as the transcript')
    expect(buildMeetingNotesRequest('A: oi', 8192, 'Portuguese').systemPrompt).toContain('Write the notes in Portuguese')
  })
})

describe('buildMeetingNotesRequest', () => {
  it('should send the transcript context with the notes instructions', () => {
    const req = buildMeetingNotesRequest('Summary of the earlier part:\n- budget\n\nA: deadline is Friday\nYou: I will send the draft', 8192)
    expect(req.prompt).toBe(NOTES_REQUEST)
    expect(req.context).toContain('You: I will send the draft')
    expect(req.context).toContain('Summary of the earlier part')
    expect(req.systemPrompt).toContain('You, A')
  })

  it('should trim the context so the request fits the prompt budget', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `A: line ${i} about the roadmap`).join('\n')
    const req = buildMeetingNotesRequest(lines, 4096)
    const total = estimateTokens(req.systemPrompt) + estimateTokens(req.prompt) + estimateTokens(req.context)
    expect(total).toBeLessThanOrEqual(promptBudget(4096))
    // The most recent part survives the trim
    expect(req.context).toContain('line 1999 about the roadmap')
    expect(req.context).not.toContain('line 0 about')
  })

  it('should return an empty context for an empty transcript', () => {
    expect(buildMeetingNotesRequest('   ', 8192).context).toBe('')
  })
})

describe('notes export', () => {
  it('should unwrap a fenced Markdown reply', () => {
    expect(normalizeNotesMarkdown('```markdown\n## Summary\nDone.\n```')).toBe('## Summary\nDone.')
    expect(normalizeNotesMarkdown('  ## Summary\nDone.  ')).toBe('## Summary\nDone.')
  })

  it('should build a Markdown document with a title and metadata', () => {
    const doc = notesDocument('```md\n## Summary\nShipped.\n\n## Action items\n- [ ] Send draft — You\n```', {
      date: new Date(2026, 9, 13, 14, 30),
      model: 'gemma4:latest',
      preset: 'Sales call',
    })
    expect(doc.startsWith('# Meeting notes\n\n_')).toBe(true)
    expect(doc).toContain('Model: gemma4:latest')
    expect(doc).toContain('Preset: Sales call')
    expect(doc).toContain('2026')
    expect(doc).toContain('## Summary\nShipped.')
    expect(doc).toContain('- [ ] Send draft — You')
    expect(doc).not.toContain('```')
    expect(doc.endsWith('\n')).toBe(true)
  })
})
