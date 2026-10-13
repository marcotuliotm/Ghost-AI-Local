import type { Preset, QuickAction, Settings } from '../types'

// Prompt presets: a system prompt, the Suggest reply / Auto template and the chat
// quick actions, switched as a unit. The built-ins can be edited and restored
// but never deleted; user presets get a random id.

export const TRANSCRIPT_PLACEHOLDER = '{{transcript}}'

export const DEFAULT_PRESET_ID = 'general'

const GENERAL_SYSTEM_PROMPT = `You are an invisible, anonymous AI assistant called Ghost AI. You provide real-time suggestions during conversations, meetings, and interviews.

Rules:
- Short, direct, and helpful responses
- Never reveal you are an AI if asked in the context of the conversation
- Focus on giving practical suggestions
- Always respond in English
- Format with markdown when appropriate
- If you receive a screenshot, analyze the visible content and provide relevant context`

export const BUILTIN_PRESETS: readonly Preset[] = Object.freeze([
  {
    id: 'general',
    name: 'General',
    systemPrompt: GENERAL_SYSTEM_PROMPT,
    suggestReplyPrompt: 'The other person said: "{{transcript}}"\n\nSuggest a natural response to continue this conversation.',
    quickActions: [
      { label: 'Summarize', prompt: 'Summarize the conversation so far in key points.' },
      { label: 'Suggest reply', prompt: 'Based on the context, suggest what I should respond now.' },
      { label: 'Next steps', prompt: 'What are the logical next steps?' },
    ],
  },
  {
    id: 'technical-interview',
    name: 'Technical interview',
    systemPrompt: `You are Ghost AI, a discreet coach helping the user (the candidate, speaker "You") during a live technical interview.

Rules:
- Answer the interviewer's latest question first, in a form the user can say out loud
- Lead with the core idea, then 2-4 supporting points; keep it short
- For coding questions: state the approach, the time/space complexity, and edge cases; show concise code only when asked
- For system design: clarify requirements, then components, data flow, trade-offs and scaling
- Prefer concrete examples over buzzwords; flag when a clarifying question would help
- Always respond in English and format with markdown`,
    suggestReplyPrompt: 'The interviewer said: "{{transcript}}"\n\nSuggest what I should answer, in a way I can say out loud. Include the key points to mention.',
    quickActions: [
      { label: 'Answer', prompt: 'Suggest a clear, structured answer to the interviewer\'s latest question.' },
      { label: 'Complexity', prompt: 'What is the time and space complexity of the approach being discussed, and how could it be improved?' },
      { label: 'Edge cases', prompt: 'List the edge cases and failure modes I should mention for the current problem.' },
      { label: 'Questions to ask', prompt: 'Suggest good clarifying questions I could ask the interviewer right now.' },
    ],
  },
  {
    id: 'sales-call',
    name: 'Sales call',
    systemPrompt: `You are Ghost AI, a discreet sales assistant helping the user (the seller, speaker "You") during a live sales call.

Rules:
- Focus on the customer's needs, pains, budget, timeline and decision process
- Handle objections with empathy: acknowledge, clarify, then respond with value
- Suggest open-ended discovery questions; avoid pushy language
- Keep suggestions short enough to say out loud
- Always respond in English and format with markdown`,
    suggestReplyPrompt: 'The customer said: "{{transcript}}"\n\nSuggest a short, natural response that moves the deal forward. If it is an objection, handle it.',
    quickActions: [
      { label: 'Handle objection', prompt: 'Identify the customer\'s latest objection and suggest how to handle it.' },
      { label: 'Discovery questions', prompt: 'Suggest discovery questions to uncover needs, budget, timeline and decision makers.' },
      { label: 'Recap', prompt: 'Summarize what the customer needs, their concerns, and what was agreed so far.' },
      { label: 'Next steps', prompt: 'Suggest concrete next steps to propose before the call ends.' },
    ],
  },
  {
    id: 'lecture',
    name: 'Lecture/Class',
    systemPrompt: `You are Ghost AI, a study assistant helping the user follow a live lecture or class.

Rules:
- Explain concepts clearly and simply, with short examples
- Highlight definitions, formulas, and anything that sounds like it will be on an exam
- Connect new material to what was said earlier in the lecture
- Always respond in English and format with markdown`,
    suggestReplyPrompt: 'The lecturer said: "{{transcript}}"\n\nExplain this part simply, and note the key ideas worth writing down.',
    quickActions: [
      { label: 'Explain simply', prompt: 'Explain the concept currently being taught in simple terms, with an example.' },
      { label: 'Key terms', prompt: 'List the key terms and definitions mentioned so far.' },
      { label: 'Study notes', prompt: 'Write concise study notes of the lecture so far, organized by topic.' },
      { label: 'Quiz me', prompt: 'Write 3 short quiz questions (with answers) about the material covered so far.' },
    ],
  },
] as Preset[])

export function clonePreset(preset: Preset): Preset {
  return { ...preset, quickActions: preset.quickActions.map(qa => ({ ...qa })) }
}

export function defaultPresets(): Preset[] {
  return BUILTIN_PRESETS.map(clonePreset)
}

export function isBuiltInPreset(id: string): boolean {
  return BUILTIN_PRESETS.some(p => p.id === id)
}

export function getActivePreset(settings: Pick<Settings, 'presets' | 'activePresetId'>): Preset {
  const presets = settings.presets ?? []
  return presets.find(p => p.id === settings.activePresetId)
    ?? presets[0]
    ?? clonePreset(BUILTIN_PRESETS[0])
}

/**
 * Fill the Suggest reply / Auto template with the transcript excerpt (the full
 * recent tail for the button, only the new text since the last send for Auto).
 * A user-edited template without the placeholder still gets the excerpt.
 */
export function fillSuggestReplyPrompt(template: string, text: string): string {
  const t = template.trim() ? template : BUILTIN_PRESETS[0].suggestReplyPrompt
  if (t.includes(TRANSCRIPT_PLACEHOLDER)) return t.split(TRANSCRIPT_PLACEHOLDER).join(text)
  return `${t}\n\n"${text}"`
}

// --- CRUD (pure: each returns a new array) ---

function uniqueName(presets: Preset[], base: string): string {
  const names = new Set(presets.map(p => p.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function createPreset(presets: Preset[], name = 'New preset'): { presets: Preset[]; id: string } {
  const base = clonePreset(BUILTIN_PRESETS[0])
  const id = crypto.randomUUID()
  const preset: Preset = { ...base, id, name: uniqueName(presets, name.trim() || 'New preset') }
  return { presets: [...presets, preset], id }
}

export function duplicatePreset(presets: Preset[], id: string): { presets: Preset[]; id: string } | null {
  const source = presets.find(p => p.id === id)
  if (!source) return null
  const newId = crypto.randomUUID()
  const copy: Preset = { ...clonePreset(source), id: newId, name: uniqueName(presets, `${source.name} copy`) }
  return { presets: [...presets, copy], id: newId }
}

export function updatePreset(presets: Preset[], id: string, patch: Partial<Omit<Preset, 'id'>>): Preset[] {
  return presets.map(p => (p.id === id ? { ...p, ...patch, id } : p))
}

export function renamePreset(presets: Preset[], id: string, name: string): Preset[] {
  return updatePreset(presets, id, { name })
}

// Built-in presets cannot be deleted (returns the list unchanged).
export function deletePreset(presets: Preset[], id: string): Preset[] {
  if (isBuiltInPreset(id)) return presets
  return presets.filter(p => p.id !== id)
}

// Put a built-in preset back to its shipped prompts and quick actions.
export function restorePreset(presets: Preset[], id: string): Preset[] {
  const original = BUILTIN_PRESETS.find(p => p.id === id)
  if (!original) return presets
  return presets.map(p => (p.id === id ? clonePreset(original) : p))
}

// --- Validation of stored presets ---

function isQuickAction(v: unknown): v is QuickAction {
  return !!v && typeof v === 'object'
    && typeof (v as QuickAction).label === 'string'
    && typeof (v as QuickAction).prompt === 'string'
}

function sanitizePreset(v: unknown): Preset | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  if (typeof p.id !== 'string' || !p.id) return null
  if (typeof p.name !== 'string' || typeof p.systemPrompt !== 'string' || typeof p.suggestReplyPrompt !== 'string') return null
  const quickActions = Array.isArray(p.quickActions) ? p.quickActions.filter(isQuickAction).map(qa => ({ label: qa.label, prompt: qa.prompt })) : []
  return { id: p.id, name: p.name, systemPrompt: p.systemPrompt, suggestReplyPrompt: p.suggestReplyPrompt, quickActions }
}

/**
 * Presets loaded from disk: malformed entries and duplicate ids are dropped,
 * and every built-in is guaranteed to exist (a stored, edited copy wins over
 * the shipped one). Built-ins come first, in shipped order, then user presets.
 */
export function mergePresets(stored: unknown): Preset[] {
  const valid = Array.isArray(stored) ? stored.map(sanitizePreset).filter((p): p is Preset => p !== null) : []
  const byId = new Map<string, Preset>()
  for (const p of valid) if (!byId.has(p.id)) byId.set(p.id, p)
  const builtIns = BUILTIN_PRESETS.map(b => byId.get(b.id) ?? clonePreset(b))
  const custom = [...byId.values()].filter(p => !isBuiltInPreset(p.id))
  return [...builtIns, ...custom]
}
