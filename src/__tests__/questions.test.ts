import { describe, it, expect } from 'vitest'
import { isQuestion, lastSentence } from '../lib/questions'

describe('isQuestion', () => {
  it('should detect questions Whisper punctuated', () => {
    expect(isQuestion('What is the budget?')).toBe(true)
    expect(isQuestion('Thanks for joining. Can you share your screen?')).toBe(true)
    expect(isQuestion('Você consegue mandar até sexta?')).toBe(true)
    expect(isQuestion('¿Cuándo empezamos?')).toBe(true)
  })

  it('should detect unpunctuated questions by their opening', () => {
    expect(isQuestion('how would you scale this service')).toBe(true)
    expect(isQuestion('o que você acha disso')).toBe(true)
    expect(isQuestion('quando podemos começar')).toBe(true)
  })

  it('should ignore statements', () => {
    expect(isQuestion('The budget is ten thousand.')).toBe(false)
    expect(isQuestion('How we got here is a long story.')).toBe(false) // ends with "."
    expect(isQuestion('Como eu disse, o projeto atrasou.')).toBe(false)
    expect(isQuestion('Porque o projeto atrasou')).toBe(false)
    expect(isQuestion('What?')).toBe(false) // too short to answer
    expect(isQuestion('')).toBe(false)
  })

  it('should only look at the last sentence', () => {
    expect(isQuestion('Is it ready? Yes, it shipped yesterday.')).toBe(false)
    expect(lastSentence('One. Two? Three')).toBe('Three')
  })
})
