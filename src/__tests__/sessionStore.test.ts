import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ENCRYPTION_UNAVAILABLE, SessionStore, type Cipher } from '../../electron/sessions'
import type { Session } from '../lib/sessions'

const ID = '0b6a8f4e-3c2d-4e1f-9a8b-7c6d5e4f3a2b'
const ID2 = '1b6a8f4e-3c2d-4e1f-9a8b-7c6d5e4f3a2b'
const session = (over: Partial<Session> = {}): Session => ({
  id: ID, startedAt: 1, updatedAt: 1, title: 'Call', model: 'm', preset: 'General', transcript: 'You: hello there', messages: [], ...over,
})

// Fake cipher: XOR with a key byte, so the file never holds the plain text
const cipher = (key = 0x5a): Cipher => ({
  encrypt: text => Buffer.from(Buffer.from(text, 'utf-8').map(b => b ^ key)),
  decrypt: data => Buffer.from(data.map(b => b ^ key)).toString('utf-8'),
})

let dir: string
beforeEach(() => { dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-sessions-')), 'sessions') })
afterEach(() => { fs.rmSync(path.dirname(dir), { recursive: true, force: true }) })

const fileText = (id = ID) => fs.readFileSync(path.join(dir, `${id}.json`), 'utf-8')

describe('SessionStore', () => {
  it('should save one encrypted file per session and read it back after a restart', () => {
    const store = new SessionStore(dir, cipher())
    expect(store.encrypted).toBe(true)
    expect(store.save(session())).toBe(true)
    expect(store.save(session({ transcript: 'You: hello again', updatedAt: 2 }))).toBe(true) // replaces
    expect(fs.readdirSync(dir)).toEqual([`${ID}.json`])
    expect(fileText()).not.toContain('hello')
    expect(JSON.parse(fileText())).toMatchObject({ version: 1, encrypted: expect.any(String) })
    const reopened = new SessionStore(dir, cipher())
    expect(reopened.get(ID)?.transcript).toBe('You: hello again')
    expect(reopened.search('again').map(s => s.id)).toEqual([ID])
  })

  it('should not save anything without encryption', () => {
    const store = new SessionStore(dir, null)
    expect(store.encrypted).toBe(false)
    expect(() => store.save(session())).toThrow(ENCRYPTION_UNAVAILABLE)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('should encrypt sessions saved before encryption existed', () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${ID}.json`), JSON.stringify(session()))
    const store = new SessionStore(dir, cipher())
    expect(store.get(ID)?.transcript).toBe('You: hello there')
    expect(fileText()).not.toContain('hello')
    expect(new SessionStore(dir, cipher()).get(ID)?.transcript).toBe('You: hello there')
  })

  it('should skip files it cannot decrypt (key gone) without deleting them', () => {
    new SessionStore(dir, cipher(0x5a)).save(session())
    expect(new SessionStore(dir, cipher(0x33)).search('')).toEqual([])
    expect(new SessionStore(dir, null).search('')).toEqual([])
    expect(fs.existsSync(path.join(dir, `${ID}.json`))).toBe(true)
  })

  it('should refuse malformed sessions and path-like ids', () => {
    const store = new SessionStore(dir, cipher())
    expect(store.save({ ...session(), id: '../settings' })).toBe(false)
    expect(store.get('../settings')).toBeNull()
    store.delete('../settings')
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('should delete one or all sessions, including unreadable files', () => {
    const store = new SessionStore(dir, cipher())
    store.save(session())
    store.save(session({ id: ID2 }))
    fs.writeFileSync(path.join(dir, 'broken.json'), '{')
    store.delete(ID)
    expect(store.search('').map(s => s.id)).toEqual([ID2])
    store.deleteAll()
    expect(store.search('')).toEqual([])
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('should skip files whose name does not match the id', () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${ID2}.json`), JSON.stringify(session()))
    expect(new SessionStore(dir, cipher()).search('')).toEqual([])
  })
})
