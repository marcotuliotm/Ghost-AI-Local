import fs from 'fs'
import path from 'path'
import {
  isValidSessionId,
  sanitizeSession,
  searchSessions,
  type Session,
  type SessionSummary,
} from '../src/lib/sessions'

// Encrypts session files: Electron's safeStorage in the app (key kept in the
// macOS Keychain / Windows DPAPI / the Linux secret store), a fake in tests.
export interface Cipher {
  encrypt: (text: string) => Buffer
  decrypt: (data: Buffer) => string
}

export const ENCRYPTION_UNAVAILABLE =
  'Encryption is not available on this system, so sessions are not saved.'

const FILE_VERSION = 1

/**
 * Saved sessions (transcript + chat + notes), one encrypted file per session
 * in userData/sessions/. Only written while Settings > Privacy > "Save session
 * history" is on, and only when encryption is available; everything stays on
 * this machine. Files from before encryption (plain JSON) are read and
 * re-written encrypted.
 */
export class SessionStore {
  private sessions = new Map<string, Session>()
  private loaded = false

  constructor(private dir: string, private cipher: Cipher | null) {}

  get encrypted(): boolean {
    return this.cipher !== null
  }

  private file(id: string) {
    return path.join(this.dir, `${id}.json`)
  }

  private read(name: string): { session: Session | null; plain: boolean } {
    const raw = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf-8'))
    if (typeof raw?.encrypted === 'string') {
      if (!this.cipher) return { session: null, plain: false }
      return { session: sanitizeSession(JSON.parse(this.cipher.decrypt(Buffer.from(raw.encrypted, 'base64')))), plain: false }
    }
    return { session: sanitizeSession(raw), plain: true }
  }

  private write(session: Session) {
    if (!this.cipher) throw new Error(ENCRYPTION_UNAVAILABLE)
    fs.mkdirSync(this.dir, { recursive: true })
    const target = this.file(session.id)
    const tmp = `${target}.tmp`
    const encrypted = this.cipher.encrypt(JSON.stringify(session)).toString('base64')
    fs.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, encrypted }))
    fs.renameSync(tmp, target) // atomic: a crash never leaves a half-written file
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    let names: string[] = []
    try {
      names = fs.readdirSync(this.dir).filter(n => n.endsWith('.json'))
    } catch {
      return // no sessions yet
    }
    for (const name of names) {
      try {
        const { session, plain } = this.read(name)
        if (!session || `${session.id}.json` !== name) continue
        this.sessions.set(session.id, session)
        if (plain && this.cipher) this.write(session) // encrypt files saved before encryption
      } catch {
        // skip unreadable files (corrupt, or encrypted with a key that is gone)
      }
    }
  }

  /** Create or replace a session. Throws when encryption is unavailable; false for a malformed one. */
  save(raw: unknown): boolean {
    const session = sanitizeSession(raw)
    if (!session) return false
    this.load()
    this.write(session)
    this.sessions.set(session.id, session)
    return true
  }

  search(query: string): SessionSummary[] {
    this.load()
    return searchSessions([...this.sessions.values()], query)
  }

  get(id: string): Session | null {
    if (!isValidSessionId(id)) return null
    this.load()
    return this.sessions.get(id) ?? null
  }

  delete(id: string) {
    if (!isValidSessionId(id)) return
    this.load()
    this.sessions.delete(id)
    fs.rmSync(this.file(id), { force: true })
  }

  /** Every session file, including ones that couldn't be read. */
  deleteAll() {
    this.sessions.clear()
    try {
      for (const name of fs.readdirSync(this.dir)) {
        if (name.endsWith('.json') || name.endsWith('.json.tmp')) fs.rmSync(path.join(this.dir, name), { force: true })
      }
    } catch {
      // nothing saved yet
    }
  }
}
