import { describe, it, expect } from 'vitest'
import { contentSecurityPolicy } from '../lib/csp'

const directive = (policy: string, name: string) =>
  policy.split('; ').find(d => d.startsWith(`${name} `))?.slice(name.length + 1)

describe('contentSecurityPolicy', () => {
  it('should forbid all network access and inline scripts in production', () => {
    const policy = contentSecurityPolicy(false)
    expect(directive(policy, 'default-src')).toBe("'none'")
    expect(directive(policy, 'connect-src')).toBe("'none'")
    expect(directive(policy, 'script-src')).toBe("'self' blob:")
    expect(directive(policy, 'object-src')).toBe("'none'")
    expect(directive(policy, 'img-src')).toBe("'self' data: blob:")
    expect(policy).not.toContain('http')
  })

  it('should only add what the Vite dev server needs in dev', () => {
    const policy = contentSecurityPolicy(true)
    expect(directive(policy, 'script-src')).toContain("'unsafe-inline'")
    expect(directive(policy, 'connect-src')).toBe("'self' ws://localhost:* http://localhost:*")
  })
})
